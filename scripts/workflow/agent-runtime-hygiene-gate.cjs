#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const STAGING_MARKER = ".fc-mcp-ingest-staging";
const ALLOWED_RUNTIME_BASENAMES = new Set([
  "mcp-ingest-failure.json",
  "mcp-ingest-last.log",
  "ui-preflight-report.json",
]);

/**
 * @param {string} root
 * @param {{ cacheDir?: string, maxStagingAgeHours?: number }} [options]
 * @returns {{ ok: boolean, blocking: string[], warnings: string[] }}
 */
function runAgentRuntimeHygieneGate(root, options) {
  const cacheDirRel = (options && options.cacheDir) || process.env.FIGMA_CACHE_DIR || "figma-cache";
  const maxAgeMs =
    ((options && options.maxStagingAgeHours) || 24) * 60 * 60 * 1000;
  const runtimeDir = path.join(root, cacheDirRel, "reports", "runtime");
  const blocking = [];
  const warnings = [];

  if (!fs.existsSync(runtimeDir)) {
    return { ok: true, blocking, warnings };
  }

  const entries = fs.readdirSync(runtimeDir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(runtimeDir, ent.name);
    if (ent.isFile()) {
      if (/\.(cjs|mjs)$/i.test(ent.name)) {
        blocking.push(
          `Forbidden agent glue script: ${path.relative(root, abs).replace(/\\/g, "/")} (use mcp-raw-ingest --stdin or --materialize-staging only)`,
        );
        continue;
      }
      if (!ALLOWED_RUNTIME_BASENAMES.has(ent.name) && /\.(txt|xml|json)$/i.test(ent.name)) {
        warnings.push(
          `Stale runtime artifact (consider deleting): ${path.relative(root, abs).replace(/\\/g, "/")}`,
        );
      }
      continue;
    }

    if (ent.isDirectory() && /^staging-/i.test(ent.name)) {
      const marker = path.join(abs, STAGING_MARKER);
      const stat = fs.statSync(abs);
      const age = Date.now() - stat.mtimeMs;
      if (!fs.existsSync(marker)) {
        blocking.push(
          `Forbidden agent staging dir without ${STAGING_MARKER}: ${path.relative(root, abs).replace(/\\/g, "/")}`,
        );
      } else if (age > maxAgeMs) {
        warnings.push(
          `Old script staging dir (${Math.round(age / 3600000)}h): ${path.relative(root, abs).replace(/\\/g, "/")}`,
        );
      }
    }
  }

  return { ok: blocking.length === 0, blocking, warnings };
}

function main() {
  const root = process.cwd();
  const strict = process.argv.includes("--strict");
  const json = process.argv.includes("--json");
  const report = runAgentRuntimeHygieneGate(root);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`agent-runtime-hygiene: ${report.ok ? "pass" : "fail"}`);
    report.blocking.forEach((b) => console.error(`- ${b}`));
    report.warnings.forEach((w) => console.warn(`- ${w}`));
  }

  if (!report.ok && strict) {
    process.exit(2);
  }
  if (!report.ok && !strict) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runAgentRuntimeHygieneGate, ALLOWED_RUNTIME_BASENAMES };
