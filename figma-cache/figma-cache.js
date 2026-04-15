#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { URL } = require("url");
const { handleFlowCommand } = require("./js/flow-cli");
const { validateMcpRawEvidence, validateIndex } = require("./js/validate-cli");
const { buildBudgetReport } = require("./js/budget-cli");
const { createIndexStore } = require("./js/index-store");
const { copyCursorBootstrap } = require("./js/cursor-bootstrap-cli");
const { createEntryFilesService } = require("./js/entry-files");
const { backfillFromIterations } = require("./js/backfill-cli");
const { createUpsertService } = require("./js/upsert-core");
const { createProjectConfigService } = require("./js/project-config");

const ROOT = process.cwd();
const NORMALIZATION_VERSION = 1;
const SCHEMA_VERSION = 2;
const DEFAULT_COMPLETENESS = Object.freeze([
  "layout",
  "text",
  "tokens",
  "interactions",
  "states",
  "accessibility",
]);
const COMPLETENESS_ALL_DIMENSIONS = Object.freeze([
  "layout",
  "text",
  "tokens",
  "interactions",
  "states",
  "accessibility",
  "flow",
  "assets",
]);
const COMPLETENESS_TOOL_REQUIREMENTS = Object.freeze({
  layout: Object.freeze([
    Object.freeze(["get_metadata", "get_design_context"]),
  ]),
  text: Object.freeze([Object.freeze(["get_design_context"])]),
  tokens: Object.freeze([Object.freeze(["get_variable_defs"])]),
  interactions: Object.freeze([Object.freeze(["get_design_context"])]),
  states: Object.freeze([Object.freeze(["get_design_context"])]),
  accessibility: Object.freeze([Object.freeze(["get_design_context"])]),
  flow: Object.freeze([Object.freeze(["get_design_context"])]),
  assets: Object.freeze([Object.freeze(["get_design_context"])]),
});

function parsePositiveInt(input, fallback) {
  const n = Number(input);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizeSlash(input) {
  return input.replace(/\\/g, "/");
}

function resolveMaybeAbsolutePath(input) {
  if (path.isAbsolute(input)) {
    return path.normalize(input);
  }
  return path.join(ROOT, input);
}

function toProjectRelativeOrAbsolute(absPath) {
  const relative = path.relative(ROOT, absPath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return normalizeSlash(relative);
  }
  return normalizeSlash(absPath);
}

const CACHE_DIR_INPUT = process.env.FIGMA_CACHE_DIR || "figma-cache";
const ITERATIONS_DIR_INPUT =
  process.env.FIGMA_ITERATIONS_DIR || "library/figma-iterations";
const INDEX_FILE_NAME = process.env.FIGMA_CACHE_INDEX_FILE || "index.json";
const DEFAULT_FLOW_ID = process.env.FIGMA_DEFAULT_FLOW || "";
const DEFAULT_STALE_DAYS = parsePositiveInt(
  process.env.FIGMA_CACHE_STALE_DAYS,
  14,
);

const CACHE_DIR = resolveMaybeAbsolutePath(CACHE_DIR_INPUT);
/** 涓?`figma-cache/figma-cache.js` 鍚岀骇鐨?`cursor-bootstrap/`锛堥殢 npm 鍖呭垎鍙戯級 */
const CURSOR_BOOTSTRAP_DIR = path.join(__dirname, "..", "cursor-bootstrap");
const ITERATIONS_DIR = resolveMaybeAbsolutePath(ITERATIONS_DIR_INPUT);

/** 褰撳墠瀹夎鍖呭湪 package.json 涓殑 name锛堢敤浜庡啓鍏?AGENT-SETUP-PROMPT.md锛?*/
function readSelfNpmPackageName() {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const j = JSON.parse(raw);
    return j && j.name ? String(j.name) : "figma-cache-toolchain";
  } catch {
    return "figma-cache-toolchain";
  }
}
const INDEX_PATH = path.isAbsolute(INDEX_FILE_NAME)
  ? INDEX_FILE_NAME
  : path.join(CACHE_DIR, INDEX_FILE_NAME);
const CACHE_BASE_FOR_STORAGE = toProjectRelativeOrAbsolute(CACHE_DIR);

const indexStore = createIndexStore({
  fs,
  CACHE_DIR,
  INDEX_PATH,
  SCHEMA_VERSION,
  NORMALIZATION_VERSION,
});
const {
  ensureCacheDir,
  buildEmptyIndex,
  normalizeIndexShape,
  readIndex,
  writeIndex,
  getItem,
} = indexStore;

const projectConfigService = createProjectConfigService({
  fs,
  path,
  ROOT,
  createRequire,
  resolveMaybeAbsolutePath,
  normalizeSlash,
});
const { loadProjectConfig, runPostEnsureHook, getProjectConfigPath } =
  projectConfigService;

const upsertService = createUpsertService({
  URL,
  NORMALIZATION_VERSION,
  CACHE_BASE_FOR_STORAGE,
  DEFAULT_COMPLETENESS,
  normalizeCompletenessList,
  normalizeIndexShape,
  readIndex,
  getItem,
  writeIndex,
});
const { normalizeFigmaUrl, previewUpsertByUrl, upsertByUrl } = upsertService;

function resolveFlowIdFromArgs(rest) {
  const flowArg = rest.find((x) => x.startsWith("--flow="));
  if (flowArg) {
    return flowArg.split("=")[1];
  }
  if (DEFAULT_FLOW_ID) {
    return DEFAULT_FLOW_ID;
  }
  return "";
}

function normalizeCompletenessList(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set();
  const output = [];
  input.forEach((entry) => {
    const value = String(entry || "").trim();
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    output.push(value);
  });
  return output;
}

const entryFilesService = createEntryFilesService({
  fs,
  path,
  resolveMaybeAbsolutePath,
  normalizeCompletenessList,
  completenessAllDimensions: COMPLETENESS_ALL_DIMENSIONS,
  runPostEnsureHook,
});
const { ensureEntryFilesAndHook } = entryFilesService;

function parseCompletenessFromArgs(args) {
  const completenessArg = args.find((x) => x.startsWith("--completeness="));
  if (!completenessArg) {
    return {
      completeness: [...DEFAULT_COMPLETENESS],
      fromCliArg: false,
    };
  }
  return {
    completeness: normalizeCompletenessList(
      completenessArg.split("=").slice(1).join("=").split(","),
    ),
    fromCliArg: true,
  };
}

/** @returns {string} */
function inferCliExample() {
  const n = normalizeSlash(String(process.argv[1] || ""));
  if (/\/bin\/figma-cache\.js$/i.test(n)) {
    return "node bin/figma-cache.js";
  }
  if (/\/figma-cache\/figma-cache\.js$/i.test(n)) {
    return "node figma-cache/figma-cache.js";
  }
  return "figma-cache";
}

function printStale(days) {
  const index = readIndex();
  const now = Date.now();
  const threshold = days * 24 * 60 * 60 * 1000;
  const keys = Object.keys(index.items || {});
  const stale = keys.filter((cacheKey) => {
    const item = index.items[cacheKey];
    const ts = item.syncedAt ? Date.parse(item.syncedAt) : NaN;
    if (Number.isNaN(ts)) {
      return true;
    }
    return now - ts > threshold;
  });
  if (!stale.length) {
    console.log(`No stale entries (>${days}d).`);
    return;
  }
  console.log(`Stale entries (>${days}d):`);
  stale.forEach((key) => {
    console.log(`- ${key}`);
  });
}

function safeReadJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function safeFileSize(absPath) {
  try {
    return fs.statSync(absPath).size;
  } catch {
    return 0;
  }
}

function runUpsertLikeCommand(commandName, args, shouldEnsureFiles) {
  const url = args[0];
  const sourceArg = args.find((x) => x.startsWith("--source="));
  const source = sourceArg ? sourceArg.split("=")[1] : "manual";
  const allowSkeletonWithFigmaMcp = args.includes(
    "--allow-skeleton-with-figma-mcp",
  );
  const { completeness } = parseCompletenessFromArgs(args);

  const preview = previewUpsertByUrl(url, { source, completeness });
  if (source === "figma-mcp") {
    const mcpErrors = validateMcpRawEvidence(
      preview.normalized.cacheKey,
      preview.item,
      completeness,
      { allowSkeletonWithFigmaMcp },
      {
        fs,
        path,
        resolveMaybeAbsolutePath,
        safeReadJson,
        normalizeSlash,
        normalizeCompletenessList,
        completenessToolRequirements: COMPLETENESS_TOOL_REQUIREMENTS,
      },
    );
    if (mcpErrors.length) {
      console.error(
        `${commandName} failed: source=figma-mcp but MCP raw evidence is incomplete`,
      );
      mcpErrors.forEach((err) => console.error(`- ${err}`));
      process.exit(2);
    }
  }

  const result = upsertByUrl(url, { source, completeness });
  if (shouldEnsureFiles) {
    ensureEntryFilesAndHook(result.normalized.cacheKey, result.item);
    console.log(
      JSON.stringify(
        {
          cacheKey: result.normalized.cacheKey,
          ensured: true,
          paths: result.item.paths,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        cacheKey: result.normalized.cacheKey,
        scope: result.item.scope,
        syncedAt: result.item.syncedAt,
      },
      null,
      2,
    ),
  );
}
function run() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd) {
    const ex = inferCliExample();
    const defaultCompletenessText = DEFAULT_COMPLETENESS.join(",");
    console.log("Usage:");
    console.log(
      `  (invoke examples: ${ex} | node bin/figma-cache.js | node figma-cache/figma-cache.js)`,
    );
    console.log(`  ${ex} normalize <figmaUrl>`);
    console.log(`  ${ex} get <figmaUrl>`);
    console.log(
      `  ${ex} upsert <figmaUrl> [--source=manual] [--completeness=a,b] [--allow-skeleton-with-figma-mcp]  (default completeness=${defaultCompletenessText})`,
    );
    console.log(`  ${ex} validate`);
    console.log(`  ${ex} stale [--days=14]`);
    console.log(`  ${ex} backfill`);
    console.log(
      `  ${ex} budget [--mcp-only] [--cacheKey=<fileKey#nodeId>] [--limit=50]`,
    );
    console.log(
      `  ${ex} ensure <figmaUrl> [--source=manual] [--completeness=a,b] [--allow-skeleton-with-figma-mcp]  (default completeness=${defaultCompletenessText})`,
    );
    console.log(`  ${ex} init`);
    console.log(`  ${ex} config`);
    console.log(
      "  (optional) figma-cache.config.js | .figmacacherc.js | FIGMA_CACHE_PROJECT_CONFIG 鈥?hooks.postEnsure after ensure",
    );
    console.log(`  ${ex} flow init --id=<flowId> [--title=...]`);
    console.log(
      `${ex} flow add-node --flow=<flowId> <figmaUrl> [--ensure] [--source=manual] [--completeness=a,b]`,
    );
    console.log(
      `${ex} flow link --flow=<flowId> <fromUrl> <toUrl> --type=next_step [--note=...]`,
    );
    console.log(
      `${ex} flow chain --flow=<flowId> <url1> <url2> ... [--type=next_step|related]`,
    );
    console.log(`  ${ex} flow show --flow=<flowId>`);
    console.log(`  ${ex} flow mermaid --flow=<flowId>`);
    console.log(
      `${ex} cursor init [--force]  # default: overwrite .cursor templates with latest bootstrap; --force keeps existing templates (skip overwrite)`,
    );
    process.exit(1);
  }

  if (cmd === "cursor") {
    const sub = args[0];
    if (sub !== "init") {
      console.error(
        "Usage: figma-cache cursor init [--force]  # default overwrite; --force keeps existing templates",
      );
      process.exit(1);
    }
    const force = args.includes("--force");
    copyCursorBootstrap(force, {
      fs,
      path,
      ROOT,
      CACHE_DIR,
      CURSOR_BOOTSTRAP_DIR,
      normalizeSlash,
      readSelfNpmPackageName,
      packageDir: __dirname,
    });
    return;
  }

  if (cmd === "normalize") {
    const url = args[0];
    const normalized = normalizeFigmaUrl(url);
    console.log(JSON.stringify(normalized, null, 2));
    return;
  }

  if (cmd === "get") {
    const url = args[0];
    const normalized = normalizeFigmaUrl(url);
    const index = readIndex();
    const item = getItem(index, normalized.cacheKey);
    console.log(
      JSON.stringify(
        {
          found: !!item,
          cacheKey: normalized.cacheKey,
          item: item || null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "upsert") {
    runUpsertLikeCommand("upsert", args, false);
    return;
  }

  if (cmd === "ensure") {
    runUpsertLikeCommand("ensure", args, true);
    return;
  }
  if (cmd === "validate") {
    const index = readIndex();
    const errors = validateIndex(index, {
      fs,
      path,
      normalizeIndexShape,
      normalizeCompletenessList,
      resolveMaybeAbsolutePath,
      safeReadJson,
      normalizeSlash,
      completenessToolRequirements: COMPLETENESS_TOOL_REQUIREMENTS,
    });
    if (!errors.length) {
      console.log("Validation passed.");
      return;
    }
    console.error("Validation failed:");
    errors.forEach((err) => console.error(`- ${err}`));
    process.exit(2);
  }

  if (cmd === "stale") {
    const daysArg = args.find((x) => x.startsWith("--days="));
    const days = daysArg ? Number(daysArg.split("=")[1]) : DEFAULT_STALE_DAYS;
    printStale(days);
    return;
  }

  if (cmd === "backfill") {
    backfillFromIterations(
      { iterationsDir: ITERATIONS_DIR },
      {
        fs,
        path,
        upsertByUrl,
      },
    );
    return;
  }

  if (cmd === "budget") {
    const mcpOnly = args.includes("--mcp-only");
    const cacheKeyArg = args.find((x) => x.startsWith("--cacheKey="));
    const limitArg = args.find((x) => x.startsWith("--limit="));
    const cacheKey = cacheKeyArg
      ? cacheKeyArg.split("=").slice(1).join("=")
      : "";
    const limit = limitArg ? limitArg.split("=")[1] : "";
    const report = buildBudgetReport(
      { mcpOnly, cacheKey, limit },
      {
        path,
        normalizeIndexShape,
        readIndex,
        resolveMaybeAbsolutePath,
        safeReadJson,
        safeFileSize,
      },
    );
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (cmd === "config") {
    const cfg = loadProjectConfig();
    const hooks = cfg && cfg.hooks;
    console.log(
      JSON.stringify(
        {
          root: normalizeSlash(ROOT),
          cacheDir: normalizeSlash(CACHE_DIR),
          indexPath: normalizeSlash(INDEX_PATH),
          iterationsDir: normalizeSlash(ITERATIONS_DIR),
          staleDays: DEFAULT_STALE_DAYS,
          defaultFlowId: DEFAULT_FLOW_ID || null,
          defaultCompleteness: [...DEFAULT_COMPLETENESS],
          normalizationVersion: NORMALIZATION_VERSION,
          projectConfigPath: getProjectConfigPath(),
          hooks: {
            postEnsure: !!(hooks && typeof hooks.postEnsure === "function"),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "init") {
    ensureCacheDir();
    if (fs.existsSync(INDEX_PATH)) {
      console.log(
        JSON.stringify(
          {
            created: false,
            reason: "index_exists",
            indexPath: normalizeSlash(INDEX_PATH),
          },
          null,
          2,
        ),
      );
      return;
    }
    writeIndex(buildEmptyIndex());
    console.log(
      JSON.stringify(
        {
          created: true,
          indexPath: normalizeSlash(INDEX_PATH),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "flow") {
    handleFlowCommand(args, {
      resolveFlowIdFromArgs,
      parseCompletenessFromArgs,
      normalizeIndexShape,
      readIndex,
      writeIndex,
      normalizeFigmaUrl,
      getItem,
      upsertByUrl,
      ensureEntryFilesAndHook,
    });
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

run();
