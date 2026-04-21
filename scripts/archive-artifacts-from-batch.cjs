#!/usr/bin/env node
"use strict";

/**
 * Archive per-case figma-cache evidence into a dedicated artifacts root
 * (defaults to <projectRoot>/figma-cache/artifacts/by-target/), to avoid
 * polluting source directories.
 *
 * Layout (default):
 *   <outRoot>/<targetRelDir>/figma-cache/<cacheKeySanitized>/
 *     - meta.json
 *     - raw.json
 *     - spec.md
 *     - state-map.md
 *     - mcp-raw/...
 *
 * And also copies shared runtime reports into:
 *   <outRoot>/<targetRelDir>/reports/runtime/
 *
 * Usage:
 *   node scripts/archive-artifacts-from-batch.cjs --batch=./figma-e2e-batch.json
 */

const fs = require("fs");
const path = require("path");
const { readBatchV2 } = require("./ui-batch-v2.cjs");

const ROOT = process.cwd();

function resolveTargetAbs(rawTarget) {
  const trimmed = String(rawTarget || "").trim();
  if (!trimmed) return "";
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.join(ROOT, trimmed);
}

function sanitizeForPath(input) {
  return String(input || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFileIfExists(src, dst) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}

function copyDirIfExists(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return false;
  ensureDir(dstDir);
  fs.cpSync(srcDir, dstDir, { recursive: true });
  return true;
}

function parseArgs(argv) {
  const out = {
    batch: path.join(ROOT, "figma-e2e-batch.json"),
    cacheRoot: path.join(ROOT, "figma-cache"),
    reportsRuntime: path.join(ROOT, "figma-cache", "reports", "runtime"),
    outRoot:
      process.env.FIGMA_UI_ARTIFACTS_ROOT ||
      path.join(ROOT, "figma-cache", "artifacts", "by-target"),
  };
  argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--batch=")) out.batch = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--cache-root=")) out.cacheRoot = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--out-root=")) out.outRoot = arg.split("=").slice(1).join("=").trim();
  });
  return out;
}

function nodeDirFromCacheKey(cacheRootAbs, cacheKey) {
  const [fileKey, nodeId] = String(cacheKey).split("#");
  const safeNodeDir = String(nodeId || "").replace(/:/g, "-");
  return path.join(cacheRootAbs, "files", fileKey, "nodes", safeNodeDir);
}

function main() {
  const args = parseArgs(process.argv);
  const batchAbs = path.isAbsolute(args.batch) ? args.batch : path.join(ROOT, args.batch);
  const cacheRootAbs = path.isAbsolute(args.cacheRoot) ? args.cacheRoot : path.join(ROOT, args.cacheRoot);
  const reportsRuntimeAbs = path.isAbsolute(args.reportsRuntime) ? args.reportsRuntime : path.join(ROOT, args.reportsRuntime);

  if (!fs.existsSync(batchAbs)) {
    console.error(`[archive-artifacts-from-batch] batch not found: ${batchAbs}`);
    process.exit(2);
  }
  if (!fs.existsSync(cacheRootAbs)) {
    console.error(`[archive-artifacts-from-batch] cache root not found: ${cacheRootAbs}`);
    process.exit(2);
  }

  const batch = readBatchV2(batchAbs, ROOT);

  let copiedCases = 0;
  batch.cases.forEach((item) => {
    const cacheKey = String(item.cacheKey || "").trim();
    const targetAbs = resolveTargetAbs(item && item.target ? item.target.entry : "");
    if (!cacheKey) throw new Error("[archive-artifacts-from-batch] cacheKey 为空（不应发生）");
    if (!targetAbs) throw new Error(`[archive-artifacts-from-batch] case[${item.index}] target.entry 为空（不应发生）`);

    const outRootAbs = path.isAbsolute(args.outRoot) ? args.outRoot : path.join(ROOT, args.outRoot);
    const targetRelDir = sanitizeForPath(
      path.relative(ROOT, path.dirname(targetAbs)).replace(/\\/g, "/")
    );
    const artifactsRoot = path.join(outRootAbs, targetRelDir);
    const caseDir = path.join(artifactsRoot, "figma-cache", sanitizeForPath(cacheKey));

    const nodeDir = nodeDirFromCacheKey(cacheRootAbs, cacheKey);
    if (!fs.existsSync(nodeDir)) {
      console.error(`[archive-artifacts-from-batch] node dir not found for ${cacheKey}: ${nodeDir}`);
      process.exit(2);
    }

    copyFileIfExists(path.join(nodeDir, "meta.json"), path.join(caseDir, "meta.json"));
    copyFileIfExists(path.join(nodeDir, "raw.json"), path.join(caseDir, "raw.json"));
    copyFileIfExists(path.join(nodeDir, "spec.md"), path.join(caseDir, "spec.md"));
    copyFileIfExists(path.join(nodeDir, "state-map.md"), path.join(caseDir, "state-map.md"));
    copyDirIfExists(path.join(nodeDir, "mcp-raw"), path.join(caseDir, "mcp-raw"));

    // Shared runtime reports snapshot
    if (fs.existsSync(reportsRuntimeAbs)) {
      copyDirIfExists(reportsRuntimeAbs, path.join(artifactsRoot, "reports", "runtime"));
    }

    copiedCases += 1;
  });

  console.log(`[archive-artifacts-from-batch] ok (${copiedCases} cases)`);
}

main();

