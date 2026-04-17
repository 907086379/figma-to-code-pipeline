#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { getUiProfileConfig } = require("./ui-profile");

const ROOT = process.cwd();
const CACHE_DIR_INPUT = process.env.FIGMA_CACHE_DIR || "figma-cache";
const DEFAULT_OUTPUT_PATH = "figma-cache/reports/runtime/ui-quality-summary.json";

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
    preflightReport: "",
    auditReport: "",
    output: DEFAULT_OUTPUT_PATH,
  };
  argv.forEach((arg) => {
    if (arg.startsWith("--preflight-report=")) {
      options.preflightReport = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--audit-report=")) {
      options.auditReport = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.split("=").slice(1).join("=").trim() || DEFAULT_OUTPUT_PATH;
    }
  });
  return options;
}

function ensureParentDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function ratio(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const cacheDir = resolveMaybeAbsolutePath(CACHE_DIR_INPUT);
  const preflightPath = resolveMaybeAbsolutePath(
    options.preflightReport || path.join(cacheDir, "reports", "runtime", "ui-preflight-report.json")
  );
  const auditPath = resolveMaybeAbsolutePath(
    options.auditReport || path.join(cacheDir, "reports", "runtime", "ui-1to1-report.json")
  );
  const outputPath = resolveMaybeAbsolutePath(options.output);
  const profileConfig = getUiProfileConfig();

  const preflight = readJsonOrNull(preflightPath) || {};
  const audit = readJsonOrNull(auditPath) || {};
  const preflightItems = Array.isArray(preflight.items) ? preflight.items : [];
  const auditItems = Array.isArray(audit.items) ? audit.items : [];

  const preflightBlockingItems = preflightItems.filter(
    (item) => Array.isArray(item.blocking) && item.blocking.length > 0
  ).length;
  const auditPassItems = auditItems.filter(
    (item) => item && item.score && Number(item.score.total || 0) >= Number(audit.summary && audit.summary.minScore || 0)
  ).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    profile: profileConfig.profile,
    inputs: {
      preflightReport: preflightPath,
      auditReport: auditPath,
    },
    metrics: {
      checkedItems: preflightItems.length || auditItems.length,
      preflightBlockingRate: ratio(preflightBlockingItems, preflightItems.length),
      auditPassRate: ratio(auditPassItems, auditItems.length),
      firstPassAcceptedRate: ratio(auditPassItems, auditItems.length),
      averageAuditScore: Number(
        (
          auditItems.reduce((acc, item) => acc + Number(item && item.score && item.score.total || 0), 0) /
          Math.max(1, auditItems.length)
        ).toFixed(2)
      ),
      reworkRoundsEstimate: Number(
        (1 - ratio(auditPassItems, Math.max(1, auditItems.length))).toFixed(2)
      ),
    },
    trend: {
      status:
        preflightBlockingItems === 0 && auditPassItems === auditItems.length
          ? "healthy"
          : "needs-attention",
      notes: [
        "Use this file as weekly baseline input for team QA review.",
        "Track blockingRate and averageAuditScore trend in CI artifacts.",
      ],
    },
  };

  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

run();
