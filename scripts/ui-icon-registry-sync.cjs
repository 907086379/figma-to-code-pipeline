#!/usr/bin/env node
"use strict";

/**
 * Project icon registry sync (framework-agnostic output).
 *
 * Reads:
 * - ui-icon-registry.json (project root by default)
 * - figma-cache/files/<fileKey>/nodes/<nodeId>/raw.json.iconMetrics referenced by UI code (via data-cache-key)
 *
 * Writes:
 * - a TS module exporting nodeId -> icon class mapping
 *
 * Designed to be reusable across projects (React/Vue/others) as it only generates a TS file.
 *
 * Usage:
 *   node scripts/ui-icon-registry-sync.cjs
 *   node scripts/ui-icon-registry-sync.cjs --src=src --out=src/ui/iconRegistry.generated.ts
 *   FIGMA_CACHE_DIR=figma-cache node scripts/ui-icon-registry-sync.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const CACHE_DIR_INPUT = process.env.FIGMA_CACHE_DIR || "figma-cache";
const FAIL_EXIT_CODE = 2;

function parseArgs(argv) {
  const out = {
    src: "src",
    out: "src/ui/iconRegistry.generated.ts",
    registry: "ui-icon-registry.json",
  };
  argv.forEach((arg) => {
    if (arg.startsWith("--src=")) out.src = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--out=")) out.out = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--registry=")) out.registry = arg.split("=").slice(1).join("=").trim();
  });
  return out;
}

function normalizeNodeId(input) {
  const v = String(input || "").trim();
  if (!v) return "";
  return v.includes(":") ? v : v.replace(/-/g, ":");
}

function tryReadJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function walk(dirAbs, out) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
      walk(p, out);
      continue;
    }
    out.push(p);
  }
}

function extractCacheKeysFromText(content) {
  const out = new Set();
  const re = /data-cache-key\s*=\s*["']([^"']+)["']/gi;
  let m = null;
  while ((m = re.exec(content))) {
    const v = String(m[1] || "").trim();
    if (v) out.add(v);
  }
  return Array.from(out);
}

function rawJsonAbsFromCacheKey(cacheKey) {
  const ck = String(cacheKey || "").trim();
  if (!ck || !ck.includes("#")) return "";
  const [fileKey, nodeIdRaw] = ck.split("#");
  const nodeId = normalizeNodeId(nodeIdRaw);
  const safeNodeDir = String(nodeId).replace(/:/g, "-");
  const cacheDirAbs = path.isAbsolute(CACHE_DIR_INPUT) ? path.normalize(CACHE_DIR_INPUT) : path.join(ROOT, CACHE_DIR_INPUT);
  return path.join(cacheDirAbs, "files", fileKey, "nodes", safeNodeDir, "raw.json");
}

function compileIconMap(registry, rawJson) {
  const entries = Array.isArray(registry && registry.entries) ? registry.entries : [];
  const metrics = Array.isArray(rawJson && rawJson.iconMetrics) ? rawJson.iconMetrics : [];
  const out = {};

  const defaults = registry && typeof registry === "object" ? registry.defaults || {} : {};
  const inactiveColorHex = String(defaults.inactiveColorHex || "").trim();
  const dangerColorHex = String(defaults.dangerColorHex || "").trim();

  metrics.forEach((m) => {
    const name = String(m && m.name ? m.name : "").trim();
    const nodeId = String(m && m.nodeId ? m.nodeId : "").trim();
    if (!name || !nodeId) return;

    for (const entry of entries) {
      const className = String(entry && entry.className ? entry.className : "").trim();
      const colorHex = String(
        entry && (entry.colorHex || entry.color || (entry.style && entry.style.colorHex) || (entry.style && entry.style.color))
          ? (entry.colorHex || entry.color || (entry.style && (entry.style.colorHex || entry.style.color)))
          : ""
      ).trim();
      const matchers =
        entry && entry.match && Array.isArray(entry.match.figmaNodeNameRegex) ? entry.match.figmaNodeNameRegex : [];
      if (!className || !matchers.length) continue;

      const ok = matchers.some((pat) => {
        try {
          return new RegExp(String(pat), "i").test(name);
        } catch {
          return false;
        }
      });
      if (ok) {
        // Prefer explicit entry color. Otherwise fall back to registry defaults:
        // - end call => dangerColorHex
        // - others => inactiveColorHex
        const inferred =
          colorHex ||
          (/\/End call$/i.test(name) ? dangerColorHex : inactiveColorHex) ||
          "";
        out[nodeId] = { className, colorHex: inferred };
        break;
      }
    }
  });

  return out;
}

function toTsModule(iconMap) {
  const lines = [];
  lines.push("/* eslint-disable */");
  lines.push("// AUTO-GENERATED. DO NOT EDIT.");
  lines.push("// Source: ui-icon-registry.json + figma-cache/**/raw.json.iconMetrics");
  lines.push("");
  lines.push("export const ICON_CLASS_BY_NODEID: Record<string, string> = {");
  Object.keys(iconMap)
    .sort()
    .forEach((nid) => {
      lines.push(`  ${JSON.stringify(nid)}: ${JSON.stringify(iconMap[nid].className)},`);
    });
  lines.push("};");
  lines.push("");
  lines.push("export const ICON_COLOR_BY_NODEID: Record<string, string> = {");
  Object.keys(iconMap)
    .sort()
    .forEach((nid) => {
      const v = String(iconMap[nid].colorHex || "").trim();
      if (!v) return;
      lines.push(`  ${JSON.stringify(nid)}: ${JSON.stringify(v)},`);
    });
  lines.push("};");
  lines.push("");
  lines.push("export function iconRegistryClass(nodeId: string) {");
  lines.push("  return ICON_CLASS_BY_NODEID[nodeId] || '';");
  lines.push("}");
  lines.push("");
  lines.push("export function iconRegistryColor(nodeId: string, fallback: string = '#707584') {");
  lines.push("  return ICON_COLOR_BY_NODEID[nodeId] || fallback;");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function ensureDir(absDir) {
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
}

function resolveMaybeAbs(input) {
  const v = String(input || "").trim();
  if (!v) return "";
  return path.isAbsolute(v) ? path.normalize(v) : path.join(ROOT, v);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const registryAbs = resolveMaybeAbs(args.registry);
  if (!registryAbs || !fs.existsSync(registryAbs)) {
    process.exit(0);
  }
  const registry = tryReadJson(registryAbs);
  if (!registry) {
    console.error(`[ui-icon-registry-sync] invalid json: ${registryAbs}`);
    process.exit(FAIL_EXIT_CODE);
  }

  const srcAbs = resolveMaybeAbs(args.src);
  if (!srcAbs || !fs.existsSync(srcAbs)) {
    process.exit(0);
  }

  const files = [];
  walk(srcAbs, files);
  const candidates = files.filter((p) => p.endsWith(".tsx") || p.endsWith(".ts") || p.endsWith(".jsx") || p.endsWith(".js"));

  const cacheKeys = new Set();
  for (const abs of candidates) {
    const text = fs.readFileSync(abs, "utf8");
    extractCacheKeysFromText(text).forEach((k) => cacheKeys.add(k));
  }

  const merged = {};
  for (const ck of Array.from(cacheKeys)) {
    const rawAbs = rawJsonAbsFromCacheKey(ck);
    const rawJson = rawAbs && fs.existsSync(rawAbs) ? tryReadJson(rawAbs) : null;
    if (!rawJson) continue;
    const iconMap = compileIconMap(registry, rawJson);
    Object.keys(iconMap).forEach((nid) => {
      merged[nid] = iconMap[nid];
    });
  }

  const outAbs = resolveMaybeAbs(args.out);
  ensureDir(path.dirname(outAbs));
  const next = toTsModule(merged);
  const before = fs.existsSync(outAbs) ? fs.readFileSync(outAbs, "utf8") : "";
  if (before !== next) {
    fs.writeFileSync(outAbs, next, "utf8");
    console.log(`[ui-icon-registry-sync] updated: ${path.relative(ROOT, outAbs)} (${Object.keys(merged).length} icons)`);
  }
}

main();

