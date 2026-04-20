#!/usr/bin/env node
"use strict";

/**
 * Toolchain-provided icon inset exporter.
 * Reads raw.json.iconMetrics and emits a TS mapping file for machine consumption.
 *
 * CLI (single segment, flat --out OR bundled --out-dir):
 *   node scripts/generate-icon-insets.cjs --raw=<raw.json> [--raw=<raw2.json> ...] --out=<out.ts> [--max-box=24]
 *   node scripts/generate-icon-insets.cjs --raw=<raw.json> ... --out-dir=<dir> --cacheKey=<cacheKey> [--max-box=24]
 *
 * When using --out-dir, always writes `iconInsets.generated.ts` with ICON_INSETS_PX_BY_ROOT (+ ICON_INSETS_PX alias).
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {
    raw: [],
    out: "",
    maxBox: 24,
    cacheKey: "",
    outDir: "",
  };
  argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--raw=")) out.raw.push(arg.split("=").slice(1).join("=").trim());
    if (arg.startsWith("--out=")) out.out = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--out-dir=")) out.outDir = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--cacheKey=")) out.cacheKey = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--max-box=")) out.maxBox = Number(arg.split("=").slice(1).join("=").trim());
  });
  return out;
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  return String(Number(num.toFixed(4))).replace(/\.0+$/, "");
}

function mergeIconMetricsFromRawPaths(rawPaths, cwd, maxBox) {
  const mapping = {};
  const boxLimit = Number(maxBox);
  const maxB = Number.isFinite(boxLimit) && boxLimit > 0 ? boxLimit : 24;
  (rawPaths || []).forEach((rawPath) => {
    const rawAbs = path.isAbsolute(rawPath) ? rawPath : path.join(cwd || process.cwd(), rawPath);
    const data = readJson(rawAbs);
    const list = Array.isArray(data && data.iconMetrics) ? data.iconMetrics : [];
    list.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const nodeId = String(item.nodeId || "").trim();
      const boxPx = Number(item.boxPx);
      const insetPx = item.insetPx;
      if (!nodeId) return;
      if (!Number.isFinite(boxPx) || boxPx <= 0 || boxPx > maxB) return;
      if (!insetPx || typeof insetPx !== "object") return;
      // First write wins: caller orders primary raw first, then related.
      if (mapping[nodeId]) return;
      mapping[nodeId] = {
        top: Number(insetPx.top || 0),
        right: Number(insetPx.right || 0),
        bottom: Number(insetPx.bottom || 0),
        left: Number(insetPx.left || 0),
      };
    });
  });
  return mapping;
}

function stableSerializeInsetsMap(map) {
  const o = {};
  Object.keys(map || {})
    .sort()
    .forEach((k) => {
      const v = map[k] || {};
      o[k] = {
        top: Number(v.top),
        right: Number(v.right),
        bottom: Number(v.bottom),
        left: Number(v.left),
      };
    });
  return JSON.stringify(o);
}

function buildTsFlat(mapping) {
  const lines = [];
  lines.push(`export type InsetsPx = { top: number; right: number; bottom: number; left: number };`);
  lines.push("");
  lines.push("/**");
  lines.push(" * AUTO-GENERATED.");
  lines.push(" * Source: raw.json.iconMetrics (derived from get_design_context inset percentages)");
  lines.push(" */");
  lines.push("export const ICON_INSETS_PX: Record<string, InsetsPx> = {");
  Object.keys(mapping)
    .sort()
    .forEach((key) => {
      const v = mapping[key];
      lines.push(
        `  ${JSON.stringify(key)}: { top: ${formatNumber(v.top)}, right: ${formatNumber(
          v.right
        )}, bottom: ${formatNumber(v.bottom)}, left: ${formatNumber(v.left)} },`
      );
    });
  lines.push("};");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function emitInsetRecordLines(mapping, linePrefix) {
  const out = [];
  Object.keys(mapping || {})
    .sort()
    .forEach((nid) => {
      const v = mapping[nid];
      out.push(
        `${linePrefix}${JSON.stringify(nid)}: { top: ${formatNumber(v.top)}, right: ${formatNumber(
          v.right
        )}, bottom: ${formatNumber(v.bottom)}, left: ${formatNumber(v.left)} },`
      );
    });
  return out;
}

function buildTsBundled(byRoot, primaryCacheKey) {
  const lines = [];
  lines.push(`export type InsetsPx = { top: number; right: number; bottom: number; left: number };`);
  lines.push("");
  lines.push("/**");
  lines.push(" * AUTO-GENERATED.");
  lines.push(" * Source: raw.json.iconMetrics per Figma root cacheKey (batch may merge multiple roots per target).");

  const rootKeys = Object.keys(byRoot || {}).sort();
  const primaryMap = byRoot[primaryCacheKey] || byRoot[rootKeys[0]] || {};

  if (rootKeys.length === 0) {
    lines.push(" * Empty batch segment.");
    lines.push(" */");
    lines.push("export const ICON_INSETS_PX: Record<string, InsetsPx> = {};");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  if (rootKeys.length === 1) {
    lines.push(" * Single design root: only flat ICON_INSETS_PX (no BY_ROOT).");
    lines.push(" */");
    lines.push("export const ICON_INSETS_PX: Record<string, InsetsPx> = {");
    lines.push(...emitInsetRecordLines(primaryMap, "  "));
    lines.push("};");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  const serToCanonicalRoot = new Map();
  rootKeys.forEach((rk) => {
    const ser = stableSerializeInsetsMap(byRoot[rk] || {});
    if (!serToCanonicalRoot.has(ser)) serToCanonicalRoot.set(ser, rk);
  });
  const uniqueSers = Array.from(serToCanonicalRoot.keys()).sort((a, b) =>
    String(serToCanonicalRoot.get(a) || "").localeCompare(String(serToCanonicalRoot.get(b) || ""))
  );

  if (uniqueSers.length === 1) {
    const mapping = byRoot[serToCanonicalRoot.get(uniqueSers[0])] || {};
    lines.push(" * Multiple roots share one inset map: flat ICON_INSETS_PX + BY_ROOT aliases.");
    lines.push(" */");
    lines.push("export const ICON_INSETS_PX: Record<string, InsetsPx> = {");
    lines.push(...emitInsetRecordLines(mapping, "  "));
    lines.push("};");
    lines.push("");
    lines.push("export const ICON_INSETS_PX_BY_ROOT: Record<string, Record<string, InsetsPx>> = {");
    rootKeys.forEach((rk) => {
      lines.push(`  ${JSON.stringify(rk)}: ICON_INSETS_PX,`);
    });
    lines.push("};");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push(" * Distinct inset maps: shared const buckets + BY_ROOT.");
  lines.push(" */");
  const serToConst = new Map();
  uniqueSers.forEach((ser, idx) => {
    const name = `ICON_INSETS_PX__B${idx}`;
    serToConst.set(ser, name);
    const canonicalRoot = serToCanonicalRoot.get(ser);
    const mapping = byRoot[canonicalRoot] || {};
    lines.push(`const ${name}: Record<string, InsetsPx> = {`);
    lines.push(...emitInsetRecordLines(mapping, "  "));
    lines.push("};");
    lines.push("");
  });

  lines.push("export const ICON_INSETS_PX_BY_ROOT: Record<string, Record<string, InsetsPx>> = {");
  rootKeys.forEach((rk) => {
    const ser = stableSerializeInsetsMap(byRoot[rk] || {});
    const ref = serToConst.get(ser) || "ICON_INSETS_PX__B0";
    lines.push(`  ${JSON.stringify(rk)}: ${ref},`);
  });
  lines.push("};");
  lines.push("");
  lines.push("/** Default bucket: first batch row for this target (legacy flat ICON_INSETS_PX). */");
  lines.push(
    `export const ICON_INSETS_PX: Record<string, InsetsPx> = ICON_INSETS_PX_BY_ROOT[${JSON.stringify(
      primaryCacheKey
    )}] || {};`
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function legacySanitizedCacheKeyFileName(cacheKey) {
  return `iconInsets.${String(cacheKey || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120)}.generated.ts`;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.raw.length || (!args.out && !(args.outDir && args.cacheKey))) {
    console.error(
      "Usage: node scripts/generate-icon-insets.cjs --raw=<raw.json> [--raw=<raw2.json> ...] (--out=<out.ts> | --out-dir=<dir> --cacheKey=<cacheKey>) [--max-box=24]"
    );
    process.exit(2);
  }
  const cwd = process.cwd();
  let outAbs;
  let body;
  if (args.out) {
    outAbs = path.isAbsolute(args.out) ? args.out : path.join(cwd, args.out);
    const mapping = mergeIconMetricsFromRawPaths(args.raw, cwd, args.maxBox);
    body = buildTsFlat(mapping);
  } else {
    outAbs = path.join(path.isAbsolute(args.outDir) ? args.outDir : path.join(cwd, args.outDir), "iconInsets.generated.ts");
    const ck = String(args.cacheKey || "").trim();
    if (!ck) {
      console.error("[generate-icon-insets] --cacheKey required with --out-dir");
      process.exit(2);
    }
    const mapping = mergeIconMetricsFromRawPaths(args.raw, cwd, args.maxBox);
    body = buildTsBundled({ [ck]: mapping }, ck);
  }

  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, body, "utf8");
  console.log(`[generate-icon-insets] wrote -> ${outAbs}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  mergeIconMetricsFromRawPaths,
  buildTsFlat,
  buildTsBundled,
  legacySanitizedCacheKeyFileName,
};
