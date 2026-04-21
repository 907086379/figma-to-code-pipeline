#!/usr/bin/env node
"use strict";

/**
 * Auto-link related cacheKeys into figma-cache/index.json flows using
 * high-confidence heuristics based on raw.json.iconMetrics overlaps.
 *
 * Goal: reduce manual relatedCacheKeys maintenance and support "agent only mentions nodeId".
 *
 * Usage:
 *   node scripts/auto-link-related-from-batch.cjs --batch=./figma-e2e-batch.json
 *
 * Options:
 *   --flow=<flowId>                (default: env FIGMA_DEFAULT_FLOW || "auto-related")
 *   --min-shared=<n>               (default: 3) min shared iconMetrics nodeIds
 *   --min-shared-instance=<n>      (default: 2) min shared instance-path nodeIds (contain ';')
 *   --min-jaccard=<ratio>          (default: 0.35)
 *   --suggest-min-shared=<n>       (default: 1) suggestion threshold (won't auto-link)
 *   --suggest-min-shared-instance=<n> (default: 1)
 *   --suggest-min-jaccard=<ratio>  (default: 0.12)
 *   --suggest-out=<path>           (default: figma-cache/reports/runtime/auto-related-suggestions.json)
 *   --promote-min-jaccard=<ratio>  (default: 0.55) if met (with shared instance), promote to auto-link
 *   --promote-min-shared-instance=<n> (default: 2)
 *   --dry-run                      don't write index.json
 *
 * Strict mode:
 *   FIGMA_UI_AUTOLINK_STRICT=1 will exit(3) if suggestions are present.
 */

const fs = require("fs");
const path = require("path");
const { readBatchV2 } = require("./ui-batch-v2.cjs");

const ROOT = process.cwd();
const INDEX_ABS = path.join(ROOT, "figma-cache", "index.json");
const DEFAULT_SUGGEST_OUT = path.join(
  ROOT,
  "figma-cache",
  "reports",
  "runtime",
  "auto-related-suggestions.json"
);

function safeReadJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(abs, value) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

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

function parseArgs(argv) {
  const out = {
    batch: path.join(ROOT, "figma-e2e-batch.json"),
    flowId: process.env.FIGMA_DEFAULT_FLOW || "auto-related",
    minShared: 2,
    minSharedInstance: 1,
    minJaccard: 0.2,
    suggestMinShared: 1,
    suggestMinSharedInstance: 1,
    suggestMinJaccard: 0.12,
    suggestOut: process.env.FIGMA_UI_AUTOLINK_SUGGEST_OUT || DEFAULT_SUGGEST_OUT,
    promoteMinJaccard: 0.55,
    promoteMinSharedInstance: 2,
    dryRun: false,
  };
  argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--batch=")) out.batch = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--flow=")) out.flowId = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--min-shared=")) out.minShared = Number(arg.split("=").slice(1).join("=").trim());
    if (arg.startsWith("--min-shared-instance="))
      out.minSharedInstance = Number(arg.split("=").slice(1).join("=").trim());
    if (arg.startsWith("--min-jaccard=")) out.minJaccard = Number(arg.split("=").slice(1).join("=").trim());
    if (arg.startsWith("--suggest-min-shared="))
      out.suggestMinShared = Number(arg.split("=").slice(1).join("=").trim());
    if (arg.startsWith("--suggest-min-shared-instance="))
      out.suggestMinSharedInstance = Number(arg.split("=").slice(1).join("=").trim());
    if (arg.startsWith("--suggest-min-jaccard="))
      out.suggestMinJaccard = Number(arg.split("=").slice(1).join("=").trim());
    if (arg.startsWith("--suggest-out=")) out.suggestOut = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--promote-min-jaccard="))
      out.promoteMinJaccard = Number(arg.split("=").slice(1).join("=").trim());
    if (arg.startsWith("--promote-min-shared-instance="))
      out.promoteMinSharedInstance = Number(arg.split("=").slice(1).join("=").trim());
    if (arg === "--dry-run") out.dryRun = true;
  });
  return out;
}

function setFromIconMetrics(raw) {
  const list = raw && Array.isArray(raw.iconMetrics) ? raw.iconMetrics : [];
  const all = new Set();
  const instance = new Set();
  list.forEach((m) => {
    const id = m && m.nodeId ? String(m.nodeId).trim() : "";
    if (!id) return;
    all.add(id);
    if (id.includes(";")) instance.add(id);
  });
  return { all, instance };
}

function intersectionSize(a, b) {
  let c = 0;
  a.forEach((x) => {
    if (b.has(x)) c += 1;
  });
  return c;
}

function jaccard(a, b) {
  const inter = intersectionSize(a, b);
  const union = a.size + b.size - inter;
  return union <= 0 ? 0 : inter / union;
}

function ensureFlow(index, flowId) {
  index.flows = index.flows || {};
  if (!index.flows[flowId]) {
    index.flows[flowId] = {
      id: flowId,
      title: flowId,
      description: "Auto-linked by iconMetrics overlap heuristics",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      assumptions: [],
      openQuestions: [],
    };
  }
  return index.flows[flowId];
}

function addNode(flow, cacheKey) {
  flow.nodes = flow.nodes || [];
  if (!flow.nodes.includes(cacheKey)) flow.nodes.push(cacheKey);
}

function hasEdge(flow, from, to, type) {
  const edges = Array.isArray(flow.edges) ? flow.edges : [];
  return edges.some((e) => e && e.from === from && e.to === to && e.type === type);
}

function addEdge(flow, from, to, type, note) {
  flow.edges = flow.edges || [];
  if (hasEdge(flow, from, to, type)) return false;
  flow.edges.push({
    id: `${from}->${to}:${type}:${Date.now()}`,
    from,
    to,
    type,
    note: note || "",
    createdAt: new Date().toISOString(),
  });
  return true;
}

function main() {
  const args = parseArgs(process.argv);
  const batchAbs = path.isAbsolute(args.batch) ? args.batch : path.join(ROOT, args.batch);
  const index = safeReadJson(INDEX_ABS);
  if (!index || !index.items) {
    console.error(`[auto-link-related-from-batch] missing/invalid index: ${INDEX_ABS}`);
    process.exit(2);
  }
  if (!fs.existsSync(batchAbs)) {
    console.error(`[auto-link-related-from-batch] batch not found: ${batchAbs}`);
    process.exit(2);
  }
  const batch = readBatchV2(batchAbs, ROOT);

  const flow = ensureFlow(index, args.flowId);
  let links = 0;
  const suggestions = [];

  batch.cases.forEach((b) => {
    const primary = normalizeCacheKey(String(b && b.cacheKey ? b.cacheKey : ""));
    if (!primary) return;
    const primaryItem = index.items[primary];
    if (!primaryItem || !primaryItem.paths || !primaryItem.paths.raw) return;
    const primaryRawAbs = path.isAbsolute(primaryItem.paths.raw)
      ? primaryItem.paths.raw
      : path.join(ROOT, primaryItem.paths.raw);
    const primaryRaw = safeReadJson(primaryRawAbs);
    const primarySet = setFromIconMetrics(primaryRaw);
    if (primarySet.all.size === 0) return;

    const fileKey = String(primaryItem.fileKey || "").trim();
    const candidates = Object.keys(index.items)
      .filter((k) => k !== primary && index.items[k] && index.items[k].fileKey === fileKey)
      .map((k) => ({ key: k, item: index.items[k] }));

    candidates.forEach((cand) => {
      const rawPath = cand.item && cand.item.paths ? cand.item.paths.raw : "";
      if (!rawPath) return;
      const rawAbs = path.isAbsolute(rawPath) ? rawPath : path.join(ROOT, rawPath);
      const raw = safeReadJson(rawAbs);
      const set = setFromIconMetrics(raw);
      if (set.all.size === 0) return;

      const shared = intersectionSize(primarySet.all, set.all);
      const sharedInstance = intersectionSize(primarySet.instance, set.instance);
      const score = jaccard(primarySet.all, set.all);

      const promote =
        sharedInstance >= args.promoteMinSharedInstance &&
        score >= args.promoteMinJaccard;

      const ok =
        promote ||
        (shared >= args.minShared &&
          sharedInstance >= args.minSharedInstance &&
          score >= args.minJaccard);
      if (!ok) {
        const suggestOk =
          shared >= args.suggestMinShared &&
          sharedInstance >= args.suggestMinSharedInstance &&
          score >= args.suggestMinJaccard;
        if (suggestOk) {
          suggestions.push({
            from: primary,
            to: cand.key,
            fileKey,
            shared,
            sharedInstance,
            jaccard: Number(score.toFixed(4)),
          });
        }
        return;
      }

      addNode(flow, primary);
      addNode(flow, cand.key);
      const note = `auto: shared=${shared}, sharedInstance=${sharedInstance}, jaccard=${Number(
        score.toFixed(3)
      )}`;
      if (addEdge(flow, primary, cand.key, "related_auto", note)) {
        links += 1;
      }
    });
  });

  flow.updatedAt = new Date().toISOString();
  index.updatedAt = new Date().toISOString();

  if (!args.dryRun) {
    writeJson(INDEX_ABS, index);
  }
  const suggestOutAbs = path.isAbsolute(args.suggestOut) ? args.suggestOut : path.join(ROOT, args.suggestOut);
  writeJson(suggestOutAbs, {
    generatedAt: new Date().toISOString(),
    flowId: args.flowId,
    strict: process.env.FIGMA_UI_AUTOLINK_STRICT === "1",
    thresholds: {
      auto: { minShared: args.minShared, minSharedInstance: args.minSharedInstance, minJaccard: args.minJaccard },
      promote: {
        minSharedInstance: args.promoteMinSharedInstance,
        minJaccard: args.promoteMinJaccard,
      },
      suggest: {
        minShared: args.suggestMinShared,
        minSharedInstance: args.suggestMinSharedInstance,
        minJaccard: args.suggestMinJaccard,
      },
    },
    links,
    suggestions,
  });

  console.log(
    `[auto-link-related-from-batch] ok links=${links} suggestions=${suggestions.length} flow=${args.flowId} dryRun=${args.dryRun ? "1" : "0"} suggestOut=${suggestOutAbs}`
  );

  if (process.env.FIGMA_UI_AUTOLINK_STRICT === "1" && suggestions.length) {
    process.exit(3);
  }
}

main();

