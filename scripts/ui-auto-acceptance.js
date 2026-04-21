#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();
const SCRIPT_DIR = __dirname;
const CACHE_DIR_INPUT = process.env.FIGMA_CACHE_DIR || "figma-cache";
const FAIL_EXIT_CODE = 2;

function normalizeNodeId(input) {
  const v = String(input || "").trim();
  if (!v) return "";
  return v.includes(":") ? v : v.replace(/-/g, ":");
}

function rawJsonPathFromCacheKey(cacheKey) {
  const ck = String(cacheKey || "").trim();
  if (!ck || !ck.includes("#")) return "";
  const [fileKey, nodeIdRaw] = ck.split("#");
  const nodeId = normalizeNodeId(nodeIdRaw);
  const safeNodeDir = String(nodeId).replace(/:/g, "-");
  const cacheDir = resolveMaybeAbsolutePath(CACHE_DIR_INPUT);
  return path.join(cacheDir, "files", fileKey, "nodes", safeNodeDir, "raw.json");
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

function parseArgs(argv) {
  const options = {
    cacheKey: "",
    target: "",
    targetKind: "",
    auditMode: "",
    contract: "",
    minScore: 90,
    maxWarnings: 0,
    maxDiffs: 2,
    reportsOnly: false,
    preflightReport: "",
    auditReport: "",
    summaryReport: "",
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--cacheKey=")) {
      options.cacheKey = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--target=")) {
      options.target = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--target-kind=")) {
      options.targetKind = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--audit-mode=")) {
      options.auditMode = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--contract=")) {
      options.contract = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--min-score=")) {
      const n = Number(arg.split("=").slice(1).join("=").trim());
      options.minScore = Number.isFinite(n) ? n : options.minScore;
      return;
    }
    if (arg.startsWith("--max-warnings=")) {
      const n = Number(arg.split("=").slice(1).join("=").trim());
      options.maxWarnings = Number.isFinite(n) ? n : options.maxWarnings;
      return;
    }
    if (arg.startsWith("--max-diffs=")) {
      const n = Number(arg.split("=").slice(1).join("=").trim());
      options.maxDiffs = Number.isFinite(n) ? n : options.maxDiffs;
      return;
    }
    if (arg.startsWith("--preflight-report=")) {
      options.preflightReport = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--audit-report=")) {
      options.auditReport = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--summary-report=")) {
      options.summaryReport = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg === "--reports-only") {
      options.reportsOnly = true;
    }
  });

  return options;
}

function runOrExit(command) {
  try {
    execSync(command, {
      cwd: ROOT,
      stdio: "inherit",
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

function buildReportPaths(options) {
  const cacheDir = resolveMaybeAbsolutePath(CACHE_DIR_INPUT);
  return {
    preflight: resolveMaybeAbsolutePath(
      options.preflightReport || path.join(cacheDir, "reports", "runtime", "ui-preflight-report.json")
    ),
    audit: resolveMaybeAbsolutePath(
      options.auditReport || path.join(cacheDir, "reports", "runtime", "ui-1to1-report.json")
    ),
    summary: resolveMaybeAbsolutePath(
      options.summaryReport || path.join(cacheDir, "reports", "runtime", "ui-quality-summary.json")
    ),
  };
}

function evaluate(preflight, audit, summary, options) {
  const failures = [];
  const warnings = [];

  if (!preflight || typeof preflight !== "object") {
    failures.push("preflight report missing or invalid");
  } else {
    if (preflight.ok !== true) {
      failures.push("preflight.ok is not true");
    }
    const blockingCount = Number(preflight.summary && preflight.summary.blockingCount || 0);
    if (blockingCount > 0) {
      failures.push(`preflight blocking count > 0 (${blockingCount})`);
    }
  }

  if (!audit || typeof audit !== "object") {
    failures.push("audit report missing or invalid");
  } else {
    if (audit.ok !== true) {
      failures.push("audit.ok is not true");
    }
    const score = Number(audit.summary && audit.summary.score && audit.summary.score.total || 0);
    if (score < options.minScore) {
      failures.push(`audit total score too low (${score} < ${options.minScore})`);
    }
    const warningCount = Number(audit.summary && audit.summary.warningCount || 0);
    if (warningCount > options.maxWarnings) {
      failures.push(`audit warnings too many (${warningCount} > ${options.maxWarnings})`);
    }
    const diffCount = Number(audit.summary && audit.summary.diffCount || 0);
    if (diffCount > options.maxDiffs) {
      failures.push(`audit diffs too many (${diffCount} > ${options.maxDiffs})`);
    }
    const targetPath = audit.options && audit.options.targetPath;
    if (!targetPath) {
      failures.push("audit targetPath is empty; not linked to real component");
    }
    if (Array.isArray(audit.warnings) && audit.warnings.length) {
      audit.warnings.forEach((entry) => warnings.push(entry));
    }
  }

  if (!summary || typeof summary !== "object") {
    failures.push("aggregate summary report missing or invalid");
  } else {
    const status = String(summary.trend && summary.trend.status || "");
    if (status && status !== "healthy") {
      failures.push(`summary trend is not healthy (${status})`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const target = options.target ? resolveMaybeAbsolutePath(options.target) : "";
  const contract = options.contract ? resolveMaybeAbsolutePath(options.contract) : "";
  const reportPaths = buildReportPaths(options);
  const targetKind =
    String(options.targetKind || "").trim() ||
    (target && String(target).toLowerCase().endsWith(".html") ? "html" : "");
  const auditMode = String(options.auditMode || "").trim() || (targetKind === "html" ? "html-partial" : "web-strict");

  if (!options.reportsOnly) {
    const isHtml = targetKind === "html" || auditMode === "html-partial";
    if (!isHtml) {
      // Project icon registry rewrite（可选，但必须发生在 forbidden gate 之前）：
      // 若项目提供 ui-icon-registry.json，把 icon-like <img> 重写为 icon class。
      if (options.cacheKey && target) {
        const iconRewriteScript = path.join(SCRIPT_DIR, "ui-icon-rewrite.js");
        runOrExit(`node "${iconRewriteScript}" --cacheKey=${options.cacheKey} --target="${target}"`);
      }

      // 工具链 forbidden gate：Web 组件才执行（HTML 审计不适用）。
      if (target) {
        const forbiddenScript = path.join(SCRIPT_DIR, "forbidden-markup-check.cjs");
        const ckArg = options.cacheKey ? ` --cacheKey=${options.cacheKey}` : "";
        if (!runOrExit(`node "${forbiddenScript}" --file="${target}"${ckArg}`.trim())) {
          process.exit(FAIL_EXIT_CODE);
        }
      }
    }

    const preflightArgs = [];
    if (options.cacheKey) {
      preflightArgs.push(`--cacheKey=${options.cacheKey}`);
    }
    if (contract) {
      preflightArgs.push(`--contract=${contract}`);
    }
    const preflightScript = path.join(SCRIPT_DIR, "ui-preflight.js");
    if (!runOrExit(`node "${preflightScript}" ${preflightArgs.join(" ")}`.trim())) {
      process.exit(FAIL_EXIT_CODE);
    }

    // icon insets：仅 Web 组件适用
    if (!(targetKind === "html" || auditMode === "html-partial")) {
      // 若 raw.json 存在，必须生成（避免 artifacts 漂移）
      if (options.cacheKey && target) {
        const rawAbs = rawJsonPathFromCacheKey(options.cacheKey);
        if (rawAbs && fs.existsSync(rawAbs)) {
          const outDir = path.dirname(target);
          const genScript = path.join(SCRIPT_DIR, "generate-icon-insets.cjs");
          const ck = `${String(options.cacheKey).split("#")[0]}#${normalizeNodeId(String(options.cacheKey).split("#")[1])}`;
          if (!runOrExit(`node "${genScript}" --raw="${rawAbs}" --out-dir="${outDir}" --cacheKey="${ck}"`.trim())) {
            process.exit(FAIL_EXIT_CODE);
          }
        } else {
          console.warn(`[ui-auto-acceptance] icon insets skipped（raw.json 缺失）：${rawAbs}`);
        }
      }
    }

    const auditArgs = [];
    if (options.cacheKey) {
      auditArgs.push(`--cacheKey=${options.cacheKey}`);
    }
    if (target) {
      auditArgs.push(`--target=${target}`);
    }
    if (contract) {
      auditArgs.push(`--contract=${contract}`);
    }
    auditArgs.push(`--min-score=${options.minScore}`);
    const auditScript = path.join(SCRIPT_DIR, "ui-1to1-audit.js");
    auditArgs.push(`--mode=${auditMode}`);
    if (!runOrExit(`node "${auditScript}" ${auditArgs.join(" ")}`.trim())) {
      process.exit(FAIL_EXIT_CODE);
    }

    const aggregateScript = path.join(SCRIPT_DIR, "ui-report-aggregate.js");
    if (!runOrExit(`node "${aggregateScript}"`)) {
      process.exit(FAIL_EXIT_CODE);
    }
  }

  const preflight = readJsonOrNull(reportPaths.preflight);
  const audit = readJsonOrNull(reportPaths.audit);
  const summary = readJsonOrNull(reportPaths.summary);
  const verdict = evaluate(preflight, audit, summary, options);
  const output = {
    ok: verdict.ok,
    generatedAt: new Date().toISOString(),
    options: {
      cacheKey: options.cacheKey || null,
      target: target || null,
      minScore: options.minScore,
      maxWarnings: options.maxWarnings,
      maxDiffs: options.maxDiffs,
      reportsOnly: options.reportsOnly,
    },
    reports: reportPaths,
    failures: verdict.failures,
    warnings: verdict.warnings,
  };

  if (!output.ok) {
    console.error("ui-auto-acceptance failed:");
    output.failures.forEach((entry) => console.error(`- ${entry}`));
    process.exit(FAIL_EXIT_CODE);
  }

  console.log(JSON.stringify(output, null, 2));
}

run();
