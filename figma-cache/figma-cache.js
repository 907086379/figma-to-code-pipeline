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
const { parseCli } = require(path.join(__dirname, "..", "scripts", "cli-args.cjs"));
const { createCommandRegistry } = require("./js/commands");

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

/**
 * @param {string[]} tailArgs argv 片段（不含顶层子命令名）
 * @param {{ strings?: string[], arrays?: string[], booleanFlags?: string[] }} spec
 */
function parseTailWithCli(tailArgs, spec) {
  return parseCli(["node", "figma-cache", ...tailArgs], spec);
}

function resolveFlowIdFromArgs(rest) {
  const { values } = parseTailWithCli(rest, {
    strings: ["flow"],
    booleanFlags: [],
  });
  const flow = (values.flow || "").trim();
  if (flow) {
    return flow;
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
  cacheDir: CACHE_DIR,
  getRelatedCacheKeys: (cacheKey) =>
    getRelatedCacheKeysFromIndex(cacheKey, normalizeIndexShape(readIndex())),
});
const { ensureEntryFilesAndHook } = entryFilesService;

function parseCompletenessFromArgs(args) {
  const { values } = parseTailWithCli(args, {
    strings: ["completeness"],
    booleanFlags: [],
  });
  const raw = (values.completeness || "").trim();
  if (!raw) {
    return {
      completeness: [...DEFAULT_COMPLETENESS],
      fromCliArg: false,
    };
  }
  return {
    completeness: normalizeCompletenessList(raw.split(",")),
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

function buildMcpValidationDeps() {
  return {
    fs,
    path,
    resolveMaybeAbsolutePath,
    safeReadJson,
    normalizeSlash,
    normalizeCompletenessList,
    completenessToolRequirements: COMPLETENESS_TOOL_REQUIREMENTS,
    loadProjectConfig,
  };
}

const commandRegistry = createCommandRegistry({
  fs,
  path,
  root: ROOT,
  cacheDir: CACHE_DIR,
  indexPath: INDEX_PATH,
  cursorBootstrapDir: CURSOR_BOOTSTRAP_DIR,
  packageDir: __dirname,
  iterationsDir: ITERATIONS_DIR,
  parseTailWithCli,
  resolveMaybeAbsolutePath,
  normalizeSlash,
  normalizeCompletenessList,
  defaultCompleteness: DEFAULT_COMPLETENESS,
  completenessToolRequirements: COMPLETENESS_TOOL_REQUIREMENTS,
  defaultStaleDays: DEFAULT_STALE_DAYS,
  defaultFlowId: DEFAULT_FLOW_ID,
  normalizationVersion: NORMALIZATION_VERSION,
  readSelfNpmPackageName,
  normalizeFigmaUrl,
  previewUpsertByUrl,
  upsertByUrl,
  readIndex,
  writeIndex,
  buildEmptyIndex,
  normalizeIndexShape,
  ensureCacheDir,
  getItem,
  ensureEntryFilesAndHook,
  copyCursorBootstrap,
  validateMcpRawEvidence,
  validateIndex,
  buildBudgetReport,
  backfillFromIterations,
  buildContractCheckReport,
  loadProjectConfig,
  getProjectConfigPath,
  parseCompletenessFromArgs,
  resolveFlowIdFromArgs,
  handleFlowCommand,
  printStale,
  safeReadJson,
  safeReadText,
  safeFileSize,
  buildMcpValidationDeps,
});

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
    console.log(`  ${ex} validate [--strict-project] [--hygiene] [--strict]`);
    console.log(`  ${ex} project-setup <init|status|finish> [--json]`);
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

  const handler = commandRegistry.get(cmd);
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }

  handler(args);
}

run();