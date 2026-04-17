#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { getUiProfileConfig } = require("./ui-profile");

const ROOT = process.cwd();
const CACHE_DIR_INPUT = process.env.FIGMA_CACHE_DIR || "figma-cache";
const INDEX_FILE_NAME = process.env.FIGMA_CACHE_INDEX_FILE || "index.json";
const DEFAULT_CONTRACT_PATH = "figma-cache/adapters/ui-adapter.contract.json";
const DEFAULT_REPORT_PATH = "figma-cache/reports/ui-preflight-report.json";
const BLOCKING_EXIT_CODE = 2;

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

function fileExists(absPath) {
  try {
    return fs.existsSync(absPath);
  } catch {
    return false;
  }
}

function ensureParentDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function parseArgs(argv) {
  const options = {
    cacheKey: "",
    contractPath: DEFAULT_CONTRACT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    allowWarn: false,
    hasUnknownArgs: false,
    unknownArgs: [],
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--cacheKey=")) {
      options.cacheKey = arg.split("=").slice(1).join("=").trim();
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
    if (arg === "--allow-warn") {
      options.allowWarn = true;
      return;
    }
    options.hasUnknownArgs = true;
    options.unknownArgs.push(arg);
  });

  return options;
}

function hasTodoPlaceholder(text) {
  return /(TODO|待补充|待完善|待确认|占位)/i.test(String(text || ""));
}

function hasMappingEntries(contract, key) {
  if (!contract || typeof contract !== "object") {
    return false;
  }
  const value = contract[key];
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
}

function checkCoverageEvidence(item, rawJson) {
  const completeness = Array.isArray(item.completeness) ? item.completeness : [];
  const evidence =
    rawJson &&
    rawJson.coverageSummary &&
    rawJson.coverageSummary.evidence &&
    typeof rawJson.coverageSummary.evidence === "object"
      ? rawJson.coverageSummary.evidence
      : null;
  if (!evidence) {
    return false;
  }
  return completeness.every((dimension) => {
    const list = evidence[dimension];
    return Array.isArray(list) && list.length > 0;
  });
}

function validateMcpManifest(nodeDir) {
  const manifestPath = path.join(nodeDir, "mcp-raw", "mcp-raw-manifest.json");
  const manifest = readJsonOrNull(manifestPath);
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, reason: "mcp-raw manifest missing or invalid" };
  }
  if (!manifest.files || typeof manifest.files !== "object") {
    return { ok: false, reason: "mcp-raw manifest.files missing" };
  }
  return { ok: true };
}

function buildItemReport(cacheKey, item, contractReady) {
  const blocking = [];
  const warnings = [];
  const checks = {
    cacheItemExists: !!item,
    entryFilesExist: false,
    coverageEvidenceReady: false,
    contractExists: contractReady.exists,
    tokenMappingReady: contractReady.tokenMappingsReady,
    stateMappingReady: contractReady.stateMappingsReady,
    mcpRawReady: true,
  };

  if (!item) {
    blocking.push("cache item not found");
    return {
      cacheKey,
      source: "unknown",
      blocking,
      warnings,
      checks,
    };
  }

  const paths = item.paths && typeof item.paths === "object" ? item.paths : {};
  const absMeta = paths.meta ? resolveMaybeAbsolutePath(paths.meta) : "";
  const absSpec = paths.spec ? resolveMaybeAbsolutePath(paths.spec) : "";
  const absStateMap = paths.stateMap ? resolveMaybeAbsolutePath(paths.stateMap) : "";
  const absRaw = paths.raw ? resolveMaybeAbsolutePath(paths.raw) : "";

  const requiredFiles = [absMeta, absSpec, absStateMap, absRaw];
  checks.entryFilesExist = requiredFiles.every((absPath) => !!absPath && fileExists(absPath));
  if (!checks.entryFilesExist) {
    blocking.push("entry file path missing or file not found (meta/spec/state-map/raw)");
  }

  const rawJson = absRaw ? readJsonOrNull(absRaw) : null;
  checks.coverageEvidenceReady = checkCoverageEvidence(item, rawJson);
  if (!checks.coverageEvidenceReady) {
    blocking.push("raw.coverageSummary.evidence missing or incomplete");
  }

  if (!checks.contractExists) {
    blocking.push("adapter contract missing or invalid JSON");
  }
  if (!checks.tokenMappingReady) {
    blocking.push("contract tokenMappings is empty");
  }
  if (!checks.stateMappingReady) {
    blocking.push("contract stateMappings is empty");
  }

  const specText = absSpec ? readTextOrEmpty(absSpec) : "";
  const stateMapText = absStateMap ? readTextOrEmpty(absStateMap) : "";
  if (hasTodoPlaceholder(specText)) {
    warnings.push("spec.md contains TODO placeholder");
  }
  if (hasTodoPlaceholder(stateMapText)) {
    warnings.push("state-map.md contains TODO placeholder");
  }

  if (item.source === "figma-mcp") {
    const nodeDir = absMeta ? path.dirname(absMeta) : "";
    const manifestStatus = validateMcpManifest(nodeDir);
    checks.mcpRawReady = manifestStatus.ok;
    if (!manifestStatus.ok) {
      blocking.push(manifestStatus.reason);
    }
  }

  return {
    cacheKey,
    source: item.source || "manual",
    blocking,
    warnings,
    checks,
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const profileConfig = getUiProfileConfig();
  if (options.hasUnknownArgs) {
    console.error(`Unknown args: ${options.unknownArgs.join(", ")}`);
    process.exit(BLOCKING_EXIT_CODE);
  }

  const cacheDir = resolveMaybeAbsolutePath(CACHE_DIR_INPUT);
  const indexPath = path.isAbsolute(INDEX_FILE_NAME)
    ? INDEX_FILE_NAME
    : path.join(cacheDir, INDEX_FILE_NAME);
  const contractPath = resolveMaybeAbsolutePath(options.contractPath);
  const reportPath = resolveMaybeAbsolutePath(options.reportPath);

  const index = readJsonOrNull(indexPath);
  const contract = readJsonOrNull(contractPath);
  const contractReady = {
    exists: !!contract && typeof contract === "object",
    tokenMappingsReady: hasMappingEntries(contract, "tokenMappings"),
    stateMappingsReady: hasMappingEntries(contract, "stateMappings"),
  };

  const items = index && index.items && typeof index.items === "object" ? index.items : {};
  const targetCacheKeys = options.cacheKey ? [options.cacheKey] : Object.keys(items);

  const reportItems = targetCacheKeys.map((cacheKey) =>
    buildItemReport(cacheKey, items[cacheKey], contractReady)
  );

  const blockingCount = reportItems.reduce((acc, item) => acc + item.blocking.length, 0);
  const warningCount = reportItems.reduce((acc, item) => acc + item.warnings.length, 0);
  const warningBlockingCount = profileConfig.preflightTreatWarningsAsBlocking ? warningCount : 0;
  const hasBlocking = blockingCount + warningBlockingCount > 0;

  const report = {
    ok: !hasBlocking,
    generatedAt: new Date().toISOString(),
    summary: {
      checkedItems: reportItems.length,
      blockingCount,
      warningCount,
      warningBlockingCount,
      allowWarn: options.allowWarn,
      profile: profileConfig.profile,
    },
    options: {
      cacheKey: options.cacheKey || null,
      contractPath: normalizeSlash(contractPath),
      reportPath: normalizeSlash(reportPath),
    },
    items: reportItems,
  };

  ensureParentDir(reportPath);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (report.ok || (options.allowWarn && blockingCount === 0 && warningBlockingCount === 0)) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.error("ui-preflight failed:");
  reportItems.forEach((item) => {
    if (!item.blocking.length) {
      return;
    }
    console.error(`- ${item.cacheKey}`);
    item.blocking.forEach((err) => console.error(`  * ${err}`));
  });
  process.exit(BLOCKING_EXIT_CODE);
}

run();
