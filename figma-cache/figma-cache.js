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
const { getRelatedCacheKeysFromIndex } = require("./js/related-cache-keys");
const { backfillFromIterations } = require("./js/backfill-cli");
const { createUpsertService } = require("./js/upsert-core");
const { createProjectConfigService } = require("./js/project-config");
const { buildContractCheckReport } = require("./js/contract-check-cli");

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
/** 与 `figma-cache/figma-cache.js` 同级的 `cursor-bootstrap/`（随 npm 包分发） */
const CURSOR_BOOTSTRAP_DIR = path.join(__dirname, "..", "cursor-bootstrap");
const ITERATIONS_DIR = resolveMaybeAbsolutePath(ITERATIONS_DIR_INPUT);

/** 当前安装包在 package.json 里的 name（用于写入 AGENT-SETUP-PROMPT.md） */
function readSelfNpmPackageName() {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const j = JSON.parse(raw);
    return j && j.name ? String(j.name) : "figma-to-code-pipeline";
  } catch {
    return "figma-to-code-pipeline";
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
  getRelatedCacheKeys: (cacheKey) =>
    getRelatedCacheKeysFromIndex(cacheKey, normalizeIndexShape(readIndex())),
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

function safeReadText(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
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

function parseContractCheckArgs(args) {
  return {
    cacheKey: (() => {
      const item = args.find((x) => x.startsWith("--cacheKey="));
      return item ? item.split("=").slice(1).join("=").trim() : "";
    })(),
    warnUnmappedTokens: args.includes("--warn-unmapped-tokens"),
    warnUnmappedStates: args.includes("--warn-unmapped-states"),
  };
}

function runContractCheck(args) {
  const options = parseContractCheckArgs(args);
  const contractPath = resolveMaybeAbsolutePath(
    process.env.FIGMA_CACHE_ADAPTER_CONTRACT ||
      "figma-cache/adapters/ui-adapter.contract.json",
  );

  const report = buildContractCheckReport(
    {
      ...options,
      contractPath,
    },
    {
      index: readIndex(),
      contract: safeReadJson(contractPath),
      readJsonOrNull: safeReadJson,
      readTextOrEmpty: safeReadText,
      resolveMaybeAbsolutePath,
      normalizeSlash,
    },
  );

  if (!report.ok) {
    console.error("contract-check failed:");
    report.hardErrors.forEach((error) => console.error(`- ${error}`));
    if (report.warnings.length) {
      console.error("\nWarnings:");
      report.warnings.forEach((warning) => console.error(`- ${warning}`));
    }
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        contract: normalizeSlash(contractPath),
        checkedItems: report.checkedItems,
        checkedCacheKeys: report.checkedCacheKeys,
        warnings: report.warnings,
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
    console.log(
      `  ${ex} enrich <figmaUrl> [--allow-skeleton-with-figma-mcp]  # re-run entry hydrate from index + mcp-raw (no index upsert)`,
    );
    console.log(
      `  ${ex} enrich --all [--allow-skeleton-with-figma-mcp]  # same for every figma-mcp item in index.json`,
    );
    console.log(`  ${ex} init`);
    console.log(`  ${ex} config`);
    console.log(
      `  ${ex} contract-check [--cacheKey=<fileKey#nodeId>] [--warn-unmapped-tokens] [--warn-unmapped-states]`,
    );
    console.log(
      "  (optional) figma-cache.config.js | .figmacacherc.js | FIGMA_CACHE_PROJECT_CONFIG -> hooks.postEnsure after ensure",
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
      `${ex} cursor init [--overwrite] [--force]  # default safe mode; --overwrite forces replacement; --force keeps legacy behavior (no overwrite)`,
    );
    process.exit(1);
  }

  if (cmd === "cursor") {
    const sub = args[0];
    if (sub !== "init") {
      console.error(
        "Usage: figma-cache cursor init [--overwrite] [--force]  # --overwrite replaces existing templates; --force keeps legacy no-overwrite behavior",
      );
      process.exit(1);
    }
    const hasOverwrite = args.includes("--overwrite");
    const hasForce = args.includes("--force");
    if (hasOverwrite && hasForce) {
      console.error("Do not use --overwrite and --force together. Choose one mode.");
      process.exit(1);
    }
    const overwrite = hasOverwrite;
    copyCursorBootstrap({ overwrite, legacyForce: hasForce }, {
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

  if (cmd === "enrich") {
    const allowSkeletonWithFigmaMcp = args.includes("--allow-skeleton-with-figma-mcp");
    const enrichAll = args.includes("--all");
    const validateDeps = {
      fs,
      path,
      resolveMaybeAbsolutePath,
      safeReadJson,
      normalizeSlash,
      normalizeCompletenessList,
      completenessToolRequirements: COMPLETENESS_TOOL_REQUIREMENTS,
    };
    if (enrichAll) {
      const index = normalizeIndexShape(readIndex());
      const failures = [];
      const successes = [];
      Object.entries(index.items || {}).forEach(([cacheKey, item]) => {
        if (!item || item.source !== "figma-mcp") {
          return;
        }
        const completeness = normalizeCompletenessList(item.completeness);
        const mcpErrors = validateMcpRawEvidence(
          cacheKey,
          item,
          completeness,
          { allowSkeletonWithFigmaMcp },
          validateDeps,
        );
        if (mcpErrors.length) {
          failures.push({ cacheKey, errors: mcpErrors });
          return;
        }
        ensureEntryFilesAndHook(cacheKey, item);
        successes.push(cacheKey);
      });
      console.log(
        JSON.stringify(
          {
            ok: failures.length === 0,
            enriched: successes.length,
            cacheKeys: successes,
            failures,
          },
          null,
          2,
        ),
      );
      if (failures.length) {
        process.exit(2);
      }
      return;
    }
    const positional = args.filter(
      (x) =>
        x !== "--all" &&
        !x.startsWith("--allow-skeleton-with-figma-mcp") &&
        !x.startsWith("--"),
    );
    const url = positional[0];
    if (!url) {
      console.error(
        "Usage: figma-cache enrich <figmaUrl> [--allow-skeleton-with-figma-mcp]\n       figma-cache enrich --all [--allow-skeleton-with-figma-mcp]",
      );
      process.exit(1);
    }
    const normalized = normalizeFigmaUrl(url);
    const index = normalizeIndexShape(readIndex());
    const item = getItem(index, normalized.cacheKey);
    if (!item) {
      console.error(`enrich failed: cacheKey not found in index: ${normalized.cacheKey}`);
      process.exit(2);
    }
    if (item.source === "figma-mcp") {
      const completeness = normalizeCompletenessList(item.completeness);
      const mcpErrors = validateMcpRawEvidence(
        normalized.cacheKey,
        item,
        completeness,
        { allowSkeletonWithFigmaMcp },
        validateDeps,
      );
      if (mcpErrors.length) {
        console.error("enrich failed: source=figma-mcp but MCP raw evidence is incomplete");
        mcpErrors.forEach((err) => console.error(`- ${err}`));
        process.exit(2);
      }
    }
    ensureEntryFilesAndHook(normalized.cacheKey, item);
    console.log(
      JSON.stringify(
        {
          cacheKey: normalized.cacheKey,
          enriched: true,
          paths: item.paths,
        },
        null,
        2,
      ),
    );
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

  if (cmd === "contract-check") {
    runContractCheck(args);
    return;
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