#!/usr/bin/env node
"use strict";

/**
 * Generate one `iconInsets.generated.ts` per unique batch `target` path.
 * Multiple batch rows pointing at the same Vue file are merged into
 * ICON_INSETS_PX_BY_ROOT (per Figma root cacheKey); ICON_INSETS_PX aliases the first row.
 *
 * Usage:
 *   node scripts/generate-icon-insets-from-batch.cjs --batch=./figma-e2e-batch.json
 */

const fs = require("fs");
const path = require("path");
const { readBatchV2 } = require("./ui-batch-v2.cjs");
const {
  mergeIconMetricsFromRawPaths,
  buildTsBundled,
  legacySanitizedCacheKeyFileName,
} = require("./generate-icon-insets.cjs");

const ROOT = process.cwd();
const DEFAULT_INDEX_ABS = path.join(ROOT, "figma-cache", "index.json");

function normalizeNodeId(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.includes(":") ? value : value.replace(/-/g, ":");
}

function normalizeCacheKey(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  const parts = value.split("#");
  if (parts.length !== 2) return value;
  return `${parts[0]}#${normalizeNodeId(parts[1])}`;
}

function toRelatedCacheKeys(item) {
  const raw = item && item.relatedCacheKeys;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normalizeCacheKey).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => normalizeCacheKey(s))
      .filter(Boolean);
  }
  return [];
}

function extractCacheKeyFromFigmaUrl(url) {
  const input = String(url || "").trim();
  if (!input) return "";
  // Matches:
  // https://www.figma.com/design/<fileKey>/... ?node-id=9277-28552
  // https://www.figma.com/file/<fileKey>/... ?node-id=9277%3A28552
  const fileKeyMatch = input.match(/figma\.com\/(?:design|file)\/([^/]+)/i);
  const nodeIdMatch = input.match(/[?&]node-id=([^&]+)/i);
  if (!fileKeyMatch || !nodeIdMatch) return "";
  const fileKey = String(fileKeyMatch[1] || "").trim();
  const decodedNode = decodeURIComponent(String(nodeIdMatch[1] || "").trim());
  const nodeId = normalizeNodeId(decodedNode);
  if (!fileKey || !nodeId) return "";
  return `${fileKey}#${nodeId}`;
}

function toRelatedUrls(item) {
  const raw = item && item.relatedUrls;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((u) => String(u || "").trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => String(s || "").trim())
      .filter(Boolean);
  }
  return [];
}

function safeReadJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function relatedFromFlowIndex(cacheKey) {
  const enabled = process.env.FIGMA_UI_RELATED_FROM_FLOW !== "0";
  if (!enabled) return [];
  const index = safeReadJson(DEFAULT_INDEX_ABS);
  if (!index || typeof index !== "object" || !index.flows) return [];
  const flows = index.flows;
  const related = new Set();
  Object.keys(flows).forEach((flowId) => {
    const flow = flows[flowId];
    const nodes = flow && Array.isArray(flow.nodes) ? flow.nodes : [];
    if (!nodes.includes(cacheKey)) return;
    nodes.forEach((k) => {
      if (k && k !== cacheKey) related.add(normalizeCacheKey(k));
    });
  });
  return Array.from(related).filter(Boolean);
}

function resolveTargetAbs(rawTarget) {
  const trimmed = String(rawTarget || "").trim();
  if (!trimmed) return "";
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.join(ROOT, trimmed);
}

function parseArgs(argv) {
  const out = {
    batch: path.join(ROOT, "figma-e2e-batch.json"),
    maxBox: 24,
  };
  argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--batch=")) out.batch = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--max-box=")) out.maxBox = Number(arg.split("=").slice(1).join("=").trim());
  });
  return out;
}

function rawAbsPathsForCase(cacheKey, relatedCacheKeys) {
  const keys = [cacheKey, ...relatedCacheKeys];
  return keys.map((ck) => {
    const [fk, nid] = String(ck).split("#");
    const safeNodeDir = String(nid || "").replace(/:/g, "-");
    return path.join(ROOT, "figma-cache", "files", fk, "nodes", safeNodeDir, "raw.json");
  });
}

function main() {
  const args = parseArgs(process.argv);
  const batchAbs = path.isAbsolute(args.batch) ? args.batch : path.join(ROOT, args.batch);
  if (!fs.existsSync(batchAbs)) {
    console.error(`[generate-icon-insets-from-batch] batch not found: ${batchAbs}`);
    process.exit(2);
  }
  const batch = readBatchV2(batchAbs, ROOT);

  const prepared = [];
  batch.cases.forEach((item) => {
    const kind = String(item && item.target && item.target.kind ? item.target.kind : "").trim();
    if (kind === "html") {
      return;
    }
    const cacheKey = String(item && item.cacheKey ? item.cacheKey : "").trim();
    const targetAbs = resolveTargetAbs(item && item.target ? item.target.entry : "");
    const relatedCacheKeysExplicit = toRelatedCacheKeys(item && item._raw ? item._raw : {});
    const relatedCacheKeysFromUrls = toRelatedUrls(item && item._raw ? item._raw : {})
      .map(extractCacheKeyFromFigmaUrl)
      .map(normalizeCacheKey)
      .filter(Boolean);
    const relatedCacheKeysFromFlow = relatedFromFlowIndex(cacheKey);
    const relatedCacheKeys = Array.from(
      new Set([...relatedCacheKeysExplicit, ...relatedCacheKeysFromUrls, ...relatedCacheKeysFromFlow])
    ).filter(Boolean);
    if (!cacheKey) throw new Error("[generate-icon-insets-from-batch] cacheKey 为空（不应发生）");
    if (!targetAbs) throw new Error(`[generate-icon-insets-from-batch] case[${item.index}] target.entry 为空（不应发生）`);
    const rawAbsList = rawAbsPathsForCase(cacheKey, relatedCacheKeys);
    const rawKeyOrder = [cacheKey, ...relatedCacheKeys];
    rawAbsList.forEach((rawAbs, j) => {
      const ck = rawKeyOrder[j] || cacheKey;
      if (!fs.existsSync(rawAbs)) {
        console.error(`[generate-icon-insets-from-batch] raw.json not found for ${ck}: ${rawAbs}`);
        process.exit(2);
      }
    });
    prepared.push({ idx: item.index, cacheKey, targetAbs, targetDir: path.dirname(targetAbs), rawAbsList });
  });

  const byTarget = new Map();
  prepared.forEach((row) => {
    const key = path.normalize(row.targetAbs);
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(row);
  });

  const outputs = [];
  byTarget.forEach((rows) => {
    rows.sort((a, b) => a.idx - b.idx);
    const primaryCacheKey = rows[0].cacheKey;
    const byRoot = {};
    rows.forEach((r) => {
      byRoot[r.cacheKey] = mergeIconMetricsFromRawPaths(r.rawAbsList, ROOT, args.maxBox);
    });
    const outAbs = path.join(rows[0].targetDir, "iconInsets.generated.ts");
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, buildTsBundled(byRoot, primaryCacheKey), "utf8");
    rows.forEach((r) => {
      const legacy = path.join(r.targetDir, legacySanitizedCacheKeyFileName(r.cacheKey));
      if (fs.existsSync(legacy) && path.normalize(legacy) !== path.normalize(outAbs)) {
        try {
          fs.unlinkSync(legacy);
        } catch {
          /* ignore */
        }
      }
    });
    outputs.push({ target: rows[0].targetAbs, roots: rows.map((r) => r.cacheKey) });
  });

  console.log(`[generate-icon-insets-from-batch] ok (${outputs.length} target(s))`);
}

main();

