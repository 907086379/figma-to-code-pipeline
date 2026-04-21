#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeUiFacts, normalizeHexColor } = require("../figma-cache/js/ui-facts-normalizer");
const { getUiProfileConfig } = require("./ui-profile");

const ROOT = process.cwd();
const CACHE_DIR_INPUT = process.env.FIGMA_CACHE_DIR || "figma-cache";
const INDEX_FILE_NAME = process.env.FIGMA_CACHE_INDEX_FILE || "index.json";
const DEFAULT_CONTRACT_PATH = "figma-cache/adapters/ui-adapter.contract.json";
const DEFAULT_REPORT_PATH = "figma-cache/reports/runtime/ui-1to1-report.json";
const DEFAULT_MIN_SCORE = 85;
const DEFAULT_RECIPES_DIR = "figma-cache/adapters/recipes";
const FAIL_EXIT_CODE = 2;
const DEFAULT_MODE = "web-strict";

function parseBoolEnv(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function filterRemoteFigmaAssetRefs(input) {
  const text = String(input || "");
  // Mask Figma MCP asset URLs (often require auth; non-deterministic in runtime).
  // This keeps audits stable when teams choose to not ship remote figma assets.
  return text
    .replace(/https:\/\/www\.figma\.com\/api\/mcp\/asset\/[a-z0-9-]+/gi, "__FIGMA_MCP_ASSET__")
    .replace(/\bimg[A-Za-z0-9_]*\s*=\s*['"]https:\/\/www\.figma\.com\/api\/mcp\/asset\/[a-z0-9-]+['"]/gi, "img__=__FIGMA_MCP_ASSET__");
}

function normalizeSlash(input) {
  return String(input || "").replace(/\\/g, "/");
}

function resolveMaybeAbsolutePath(input) {
  if (!input) {
    return "";
  }
  return path.isAbsolute(input) ? path.normalize(input) : path.join(ROOT, input);
}

function readJsonOrNull(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function readTextOrEmpty(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const options = {
    cacheKey: "",
    targetPath: "",
    mode: DEFAULT_MODE, // web-strict | html-partial
    contractPath: DEFAULT_CONTRACT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    minScore: DEFAULT_MIN_SCORE,
    recipesDir: DEFAULT_RECIPES_DIR,
    filterRemoteFigmaAssets: parseBoolEnv(process.env.FIGMA_UI_FILTER_REMOTE_FIGMA_ASSETS, true),
    unknownArgs: [],
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--cacheKey=")) {
      options.cacheKey = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--target=")) {
      options.targetPath = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = arg.split("=").slice(1).join("=").trim() || DEFAULT_MODE;
      return;
    }
    if (arg.startsWith("--contract=")) {
      options.contractPath = arg.split("=").slice(1).join("=").trim() || DEFAULT_CONTRACT_PATH;
      return;
    }
    if (arg.startsWith("--report=")) {
      options.reportPath = arg.split("=").slice(1).join("=").trim() || DEFAULT_REPORT_PATH;
      return;
    }
    if (arg.startsWith("--min-score=")) {
      const parsed = Number(arg.split("=").slice(1).join("=").trim());
      options.minScore = Number.isFinite(parsed) ? parsed : DEFAULT_MIN_SCORE;
      return;
    }
    if (arg.startsWith("--recipes-dir=")) {
      options.recipesDir = arg.split("=").slice(1).join("=").trim() || DEFAULT_RECIPES_DIR;
      return;
    }
    if (arg === "--no-filter-remote-figma-assets") {
      options.filterRemoteFigmaAssets = false;
      return;
    }
    options.unknownArgs.push(arg);
  });

  return options;
}

function clampScore(input) {
  const n = Number(input);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function ensureParentDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((acc, n) => acc + n, 0) / values.length;
}

function readVariableDefsFromManifest(metaPath) {
  if (!metaPath) {
    return null;
  }
  const nodeDir = path.dirname(metaPath);
  const manifestPath = path.join(nodeDir, "mcp-raw", "mcp-raw-manifest.json");
  const manifest = readJsonOrNull(manifestPath);
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    !manifest.files.get_variable_defs
  ) {
    return null;
  }
  return readJsonOrNull(path.join(nodeDir, "mcp-raw", String(manifest.files.get_variable_defs)));
}

function loadRecipes(recipesDirAbs) {
  if (!recipesDirAbs || !fs.existsSync(recipesDirAbs)) {
    return [];
  }
  return fs
    .readdirSync(recipesDirAbs)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const full = path.join(recipesDirAbs, name);
      const data = readJsonOrNull(full);
      if (!data || typeof data !== "object") {
        return null;
      }
      return data;
    })
    .filter(Boolean);
}

function detectMatchedRecipes(recipes, contextText, statesInCache) {
  const context = String(contextText || "").toLowerCase();
  return recipes
    .map((recipe) => {
      const keywords = [
        String(recipe.id || "").toLowerCase(),
        ...(Array.isArray(recipe.structureTemplate) ? recipe.structureTemplate : []),
        ...(recipe.stateMachine && Array.isArray(recipe.stateMachine.requiredStates)
          ? recipe.stateMachine.requiredStates
          : []),
      ]
        .map((k) => String(k || "").toLowerCase())
        .filter(Boolean);
      const matchedKeywords = keywords.filter(
        (keyword) => context.includes(keyword) || statesInCache.includes(keyword)
      );
      return {
        id: String(recipe.id || "").toLowerCase(),
        score: keywords.length ? matchedKeywords.length / keywords.length : 0,
      };
    })
    .filter((item) => item.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.id);
}

function scoreItem(params) {
  const { cacheKey, item, contract, targetCode, recipes, options } = params;
  const blocking = [];
  const warnings = [];
  const diffs = [];
  const skippedDimensions = [];

  if (!item) {
    blocking.push(`cache item not found: ${cacheKey}`);
    return {
      cacheKey,
      score: {
        total: 0,
        layout: 0,
        text: 0,
        token: 0,
        state: 0,
        interaction: 0,
      },
      blocking,
      warnings,
      diffs,
      skippedDimensions,
    };
  }

  const paths = item.paths && typeof item.paths === "object" ? item.paths : {};
  const metaPath = paths.meta ? resolveMaybeAbsolutePath(paths.meta) : "";
  const specPath = paths.spec ? resolveMaybeAbsolutePath(paths.spec) : "";
  const stateMapPath = paths.stateMap ? resolveMaybeAbsolutePath(paths.stateMap) : "";
  const rawPath = paths.raw ? resolveMaybeAbsolutePath(paths.raw) : "";
  const entryReady = [metaPath, specPath, stateMapPath, rawPath].every((p) => !!p && fs.existsSync(p));
  if (!entryReady) {
    // html-partial 允许最小集合缺失时尽量产出报告，不默认失败
    if (String(options.mode) === "html-partial") {
      warnings.push("缓存条目文件不完整（html-partial：不默认失败）");
    } else {
      blocking.push("entry files not complete");
    }
  }

  const specText = readTextOrEmpty(specPath);
  const stateMapText = readTextOrEmpty(stateMapPath);
  const rawJson = readJsonOrNull(rawPath) || {};
  const completeness = Array.isArray(item.completeness) ? item.completeness : [];
  const evidence =
    rawJson.coverageSummary &&
    rawJson.coverageSummary.evidence &&
    typeof rawJson.coverageSummary.evidence === "object"
      ? rawJson.coverageSummary.evidence
      : {};
  const evidenceReady = completeness.every((k) => Array.isArray(evidence[k]) && evidence[k].length > 0);
  if (!evidenceReady) {
    if (String(options.mode) === "html-partial") {
      warnings.push("coverage evidence 不完整（html-partial：不默认失败）");
    } else {
      blocking.push("coverage evidence incomplete");
    }
  }

  const variableDefsJson = readVariableDefsFromManifest(metaPath);
  const normalizedFacts = normalizeUiFacts({
    specText,
    stateMapText,
    rawJson,
    variableDefsJson,
    entryReady,
    evidenceReady,
  });
  const textFacts = normalizedFacts.facts.text;
  const tokenFacts = normalizedFacts.facts.tokens;
  const statesInCache = normalizedFacts.facts.states;

  const contractTokens = Array.isArray(contract && contract.tokenMappings) ? contract.tokenMappings : [];
  const contractStates =
    contract && contract.stateMappings && typeof contract.stateMappings === "object"
      ? Object.values(contract.stateMappings)
          .flatMap((entry) => (Array.isArray(entry.requiredStates) ? entry.requiredStates : []))
          .map((v) => String(v || "").trim().toLowerCase())
          .filter(Boolean)
      : [];

  const tokenMappedHits = tokenFacts.filter((fact) => {
    const name = String(fact.name || "").trim().toLowerCase();
    const value = normalizeHexColor(String(fact.value || ""));
    return contractTokens.some((token) => {
      const tokenName = String(token.figmaToken || "").trim().toLowerCase();
      const tokenValue = normalizeHexColor(String(token.figmaValue || ""));
      return (name && name === tokenName) || (value && value === tokenValue);
    });
  }).length;
  const tokenCoverage = tokenFacts.length ? tokenMappedHits / tokenFacts.length : 1;
  if (tokenCoverage < 1) {
    diffs.push(`token mapping coverage ${Math.round(tokenCoverage * 100)}%`);
  }

  const stateHits = statesInCache.filter((state) => contractStates.includes(state)).length;
  const stateCoverage = statesInCache.length ? stateHits / statesInCache.length : 1;
  if (stateCoverage < 1) {
    diffs.push(`state mapping coverage ${Math.round(stateCoverage * 100)}%`);
  }

  const hasTodo = normalizedFacts.hasPlaceholder;
  const effectiveTargetCode =
    options && options.filterRemoteFigmaAssets
      ? filterRemoteFigmaAssetRefs(targetCode)
      : String(targetCode || "");
  const matchedRecipes = detectMatchedRecipes(
    recipes,
    `${specText}\n${stateMapText}\n${JSON.stringify(rawJson || {})}\n${effectiveTargetCode}`,
    statesInCache
  );
  if (!matchedRecipes.length) {
    warnings.push("no recipe matched; consider adding project recipe");
  }
  if (hasTodo) {
    warnings.push("cache facts still contain placeholder text");
  }

  const hasTargetCode = !!targetCode;
  if (!hasTargetCode) {
    warnings.push("target 代码为空；将跳过 code-level 对照");
  }

  const isHtmlPartial = String(options.mode) === "html-partial";

  const textCodeHits = hasTargetCode ? textFacts.filter((fact) => effectiveTargetCode.includes(fact)).length : textFacts.length;
  const tokenCodeHits = hasTargetCode
    ? tokenFacts.filter((fact) =>
        effectiveTargetCode.toUpperCase().includes(String(normalizeHexColor(fact.value || "")).toUpperCase())
      ).length
    : tokenFacts.length;
  const stateCodeHits = hasTargetCode
    ? statesInCache.filter((state) => effectiveTargetCode.toLowerCase().includes(state)).length
    : statesInCache.length;

  const layoutScore = isHtmlPartial ? null : entryReady ? 100 : 20;
  const textScore = clampScore(100 * (textFacts.length ? textCodeHits / textFacts.length : 1));
  const tokenScore = isHtmlPartial
    ? clampScore(100 * (tokenFacts.length ? tokenCodeHits / tokenFacts.length : 1))
    : clampScore(100 * tokenCoverage * (tokenFacts.length ? tokenCodeHits / tokenFacts.length : 1));
  const stateScore = isHtmlPartial
    ? null
    : clampScore(100 * stateCoverage * (statesInCache.length ? stateCodeHits / statesInCache.length : 1));
  const interactionScore = isHtmlPartial ? null : hasTodo ? 70 : normalizedFacts.dimensions.interactionReady ? 100 : 80;

  if (isHtmlPartial) {
    skippedDimensions.push("layout", "states", "interactions", "accessibility");
  }

  let totalScore = 0;
  if (isHtmlPartial) {
    const totalParts = [textScore, tokenScore].filter((n) => Number.isFinite(Number(n)));
    totalScore = clampScore(average(totalParts.length ? totalParts : [0]));
  } else {
    totalScore = clampScore(average([layoutScore, textScore, tokenScore, stateScore, interactionScore]));
    if (!hasTargetCode) {
      // 兼容“未提供 target code”的基线模式：在不阻塞的前提下，给一个可用的分数下限。
      if (!blocking.length) {
        totalScore = Math.max(totalScore, 90);
      }
    }
  }

  return {
    cacheKey,
    score: {
      total: totalScore,
      layout: layoutScore,
      text: textScore,
      token: tokenScore,
      state: stateScore,
      interaction: interactionScore,
    },
    blocking,
    warnings,
    diffs,
    matchedRecipes,
    skippedDimensions,
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const profileConfig = getUiProfileConfig();
  const minScore =
    options.minScore === DEFAULT_MIN_SCORE
      ? profileConfig.auditDefaultMinScore
      : options.minScore;
  if (options.unknownArgs.length) {
    console.error(`Unknown args: ${options.unknownArgs.join(", ")}`);
    process.exit(FAIL_EXIT_CODE);
  }
  if (!["web-strict", "html-partial"].includes(String(options.mode))) {
    console.error(`ui-1to1-audit failed: --mode 仅支持 web-strict/html-partial，实际：${JSON.stringify(options.mode)}`);
    process.exit(FAIL_EXIT_CODE);
  }

  const cacheDir = resolveMaybeAbsolutePath(CACHE_DIR_INPUT);
  const indexPath = path.isAbsolute(INDEX_FILE_NAME)
    ? INDEX_FILE_NAME
    : path.join(cacheDir, INDEX_FILE_NAME);
  const contractPath = resolveMaybeAbsolutePath(options.contractPath);
  const reportPath = resolveMaybeAbsolutePath(options.reportPath);
  const recipesDir = resolveMaybeAbsolutePath(options.recipesDir);
  const targetPath = options.targetPath ? resolveMaybeAbsolutePath(options.targetPath) : "";
  if (profileConfig.auditRequireTargetPath && !targetPath) {
    console.error(`ui-1to1-audit failed: profile '${profileConfig.profile}' requires --target`);
    process.exit(FAIL_EXIT_CODE);
  }

  const index = readJsonOrNull(indexPath);
  const contract = readJsonOrNull(contractPath);
  const items = index && index.items && typeof index.items === "object" ? index.items : {};
  const targetKeys = options.cacheKey ? [options.cacheKey] : Object.keys(items);
  const targetCode = targetPath ? readTextOrEmpty(targetPath) : "";
  const recipes = loadRecipes(recipesDir);

  const itemReports = targetKeys.map((cacheKey) =>
    scoreItem({
      cacheKey,
      item: items[cacheKey],
      contract,
      targetCode,
      recipes,
      options,
    })
  );

  const blocking = [];
  if (!index || typeof index !== "object") {
    blocking.push("index missing or invalid");
  }
  if (!contract || typeof contract !== "object") {
    if (String(options.mode) === "html-partial") {
      // html-partial 不依赖 contract（仅用 cache facts vs HTML 文本对照）
    } else {
      blocking.push("contract missing or invalid");
    }
  }
  itemReports.forEach((item) => item.blocking.forEach((msg) => blocking.push(`${item.cacheKey}: ${msg}`)));

  const warnings = itemReports.flatMap((item) => item.warnings.map((msg) => `${item.cacheKey}: ${msg}`));
  const diffs = itemReports.flatMap((item) => item.diffs.map((msg) => `${item.cacheKey}: ${msg}`));
  const totalScore = clampScore(average(itemReports.map((item) => item.score.total)));

  if (totalScore < minScore) {
    blocking.push(`score.total below threshold: ${totalScore} < ${minScore}`);
  }

  const report = {
    ok: blocking.length === 0,
    generatedAt: new Date().toISOString(),
    summary: {
      checkedItems: itemReports.length,
      score: {
        total: totalScore,
        layout: clampScore(average(itemReports.map((item) => Number(item.score.layout || 0)))),
        text: clampScore(average(itemReports.map((item) => item.score.text))),
        token: clampScore(average(itemReports.map((item) => item.score.token))),
        state: clampScore(average(itemReports.map((item) => Number(item.score.state || 0)))),
        interaction: clampScore(average(itemReports.map((item) => Number(item.score.interaction || 0)))),
      },
      blockingCount: blocking.length,
      warningCount: warnings.length,
      diffCount: diffs.length,
      minScore,
      profile: profileConfig.profile,
      recipesTotal: recipes.length,
      recipesMatchedItems: itemReports.filter((item) => Array.isArray(item.matchedRecipes) && item.matchedRecipes.length > 0)
        .length,
      auditMode: options.mode,
      skippedDimensions: Array.from(new Set(itemReports.flatMap((x) => x.skippedDimensions || []))).filter(Boolean),
    },
    options: {
      cacheKey: options.cacheKey || null,
      targetPath: targetPath ? normalizeSlash(targetPath) : null,
      mode: options.mode,
      contractPath: normalizeSlash(contractPath),
      reportPath: normalizeSlash(reportPath),
      recipesDir: normalizeSlash(recipesDir),
      filterRemoteFigmaAssets: options.filterRemoteFigmaAssets,
    },
    blocking,
    warnings,
    diffs,
    items: itemReports,
  };

  ensureParentDir(reportPath);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!report.ok) {
    console.error("ui-1to1-audit failed:");
    blocking.forEach((msg) => console.error(`- ${msg}`));
    process.exit(FAIL_EXIT_CODE);
  }

  console.log(JSON.stringify(report, null, 2));
}

run();
