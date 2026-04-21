#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { parseCli } = require("../cli-args.cjs");

const ROOT = process.cwd();
const CACHE_DIR_INPUT = process.env.FIGMA_CACHE_DIR || "figma-cache";
const FAIL_EXIT_CODE = 2;

function resolveMaybeAbsolutePath(input) {
  if (!input) return "";
  return path.isAbsolute(input)
    ? path.normalize(input)
    : path.join(ROOT, input);
}

function normalizeNodeId(input) {
  const v = String(input || "").trim();
  if (!v) return "";
  return v.includes(":") ? v : v.replace(/-/g, ":");
}

function readJsonOrNull(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function parseArgs() {
  const { values, positionals } = parseCli(process.argv, {
    strings: ["cacheKey", "target"],
    booleanFlags: [],
  });
  const out = {
    cacheKey: (values.cacheKey || "").trim(),
    target: (values.target || "").trim(),
  };
  if (!out.cacheKey) {
    const ck = positionals.find(
      (p) => p.includes("#") && !/\.(vue|tsx|jsx|html)$/i.test(p),
    );
    if (ck) out.cacheKey = ck.trim();
  }
  if (!out.target) {
    const t = positionals.find((p) => /\.(vue|tsx|jsx|html)$/i.test(p));
    if (t) out.target = t.trim();
  }
  return out;
}

function findRegistryAbs() {
  const candidates = [
    path.join(ROOT, "ui-icon-registry.json"),
    path.join(ROOT, CACHE_DIR_INPUT, "adapters", "ui-icon-registry.json"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || "";
}

function rawJsonAbsFromCacheKey(cacheKey) {
  const ck = String(cacheKey || "").trim();
  if (!ck || !ck.includes("#")) return "";
  const [fileKey, nodeIdRaw] = ck.split("#");
  const nodeId = normalizeNodeId(nodeIdRaw);
  const safeNodeDir = String(nodeId).replace(/:/g, "-");
  const cacheDir = resolveMaybeAbsolutePath(CACHE_DIR_INPUT);
  return path.join(
    cacheDir,
    "files",
    fileKey,
    "nodes",
    safeNodeDir,
    "raw.json",
  );
}

function compileIconMap(registry, rawJson) {
  const entries = Array.isArray(registry && registry.entries)
    ? registry.entries
    : [];
  const metrics = Array.isArray(rawJson && rawJson.iconMetrics)
    ? rawJson.iconMetrics
    : [];
  const out = {};

  metrics.forEach((m) => {
    const name = String(m && m.name ? m.name : "").trim();
    const nodeId = String(m && m.nodeId ? m.nodeId : "").trim();
    if (!name || !nodeId) return;

    for (const entry of entries) {
      const className = String(
        entry && entry.className ? entry.className : "",
      ).trim();
      const matchers =
        entry && entry.match && Array.isArray(entry.match.figmaNodeNameRegex)
          ? entry.match.figmaNodeNameRegex
          : [];
      if (!className || !matchers.length) continue;
      const ok = matchers.some((pat) => {
        try {
          return new RegExp(String(pat), "i").test(name);
        } catch {
          return false;
        }
      });
      if (ok) {
        out[nodeId] = className;
        break;
      }
    }
  });

  return out;
}

function injectIconHelpers(scriptBody, iconMap) {
  const lines = [];
  lines.push("");
  lines.push("const ICON_CLASS_BY_NODEID: Record<string, string> = {");
  Object.keys(iconMap)
    .sort()
    .forEach((nid) => {
      lines.push(`  ${JSON.stringify(nid)}: ${JSON.stringify(iconMap[nid])},`);
    });
  lines.push("};");
  lines.push("");
  lines.push("function iconRegistryClass(nodeId: string) {");
  lines.push('  return ICON_CLASS_BY_NODEID[nodeId] || "";');
  lines.push("}");
  lines.push("");

  const block = lines.join("\n");

  // If already present, replace to keep in sync with project registry.
  const mapRe = /const\s+ICON_CLASS_BY_NODEID:[\s\S]*?\n};\n/m;
  const fnRe = /function\s+iconRegistryClass\s*\([\s\S]*?\n}\n/m;
  let next = scriptBody;
  if (mapRe.test(next)) {
    next = next.replace(
      mapRe,
      `${block.match(/const ICON_CLASS_BY_NODEID[\s\S]*?\n};\n/m)[0]}`,
    );
  } else {
    next = `${next.replace(/\s+$/, "")}\n${block.match(/const ICON_CLASS_BY_NODEID[\s\S]*?\n};\n/m)[0]}\n`;
  }
  if (fnRe.test(next)) {
    next = next.replace(
      fnRe,
      `${block.match(/function iconRegistryClass[\s\S]*?\n}\n/m)[0]}`,
    );
  } else {
    next = `${next.replace(/\s+$/, "")}\n${block.match(/function iconRegistryClass[\s\S]*?\n}\n/m)[0]}\n`;
  }
  return next;
}

function rewriteTemplate(content) {
  // Replace the "20x20 icon img + inset wrapper" with:
  // - v-if: render icon class div
  // - v-else: keep the existing img wrapper (fallback)
  //
  // This is a heuristic targeting the toolchain-generated structure in this repo.
  const blockRe =
    /<div class="relative w-\[20px\] h-\[20px\] overflow-hidden shrink-0">[\s\S]*?<\/div>\s*<\/div>/m;

  const replacement =
    `<div v-if="iconRegistryClass(item.iconNodeId)" :class="[\n` +
    `  \`w-[20px] h-[20px] shrink-0\`,\n` +
    `  iconRegistryClass(item.iconNodeId),\n` +
    `]"></div>\n` +
    `<div v-else class="relative w-[20px] h-[20px] overflow-hidden shrink-0">\n` +
    `  <div class="absolute" :style="iconInsetStyle(item.iconNodeId)">\n` +
    `    <img class="w-full h-full block" :src="item.icon" alt="" />\n` +
    `  </div>\n` +
    `</div>`;

  if (!blockRe.test(content)) {
    return content;
  }
  return content.replace(blockRe, replacement);
}

function main() {
  const args = parseArgs();
  const registryAbs = findRegistryAbs();
  if (!registryAbs) {
    process.exit(0);
  }
  if (!args.cacheKey || !args.target) {
    console.error(
      "[ui-icon-rewrite] --cacheKey and --target required when registry exists",
    );
    process.exit(FAIL_EXIT_CODE);
  }

  const targetAbs = resolveMaybeAbsolutePath(args.target);
  if (!targetAbs || !fs.existsSync(targetAbs)) {
    console.error(`[ui-icon-rewrite] target missing: ${targetAbs}`);
    process.exit(FAIL_EXIT_CODE);
  }

  const rawAbs = rawJsonAbsFromCacheKey(args.cacheKey);
  const rawJson =
    rawAbs && fs.existsSync(rawAbs) ? readJsonOrNull(rawAbs) : null;
  const registry = readJsonOrNull(registryAbs);
  if (!rawJson || !registry) {
    process.exit(0);
  }

  const iconMap = compileIconMap(registry, rawJson);
  if (!Object.keys(iconMap).length) {
    process.exit(0);
  }

  const before = fs.readFileSync(targetAbs, "utf8");
  let next = before;

  // 1) rewrite template icon rendering
  next = rewriteTemplate(next);

  // 2) inject helpers in <script setup lang="ts">
  const scriptRe = /<script setup lang="ts">([\s\S]*?)<\/script>/m;
  const m = next.match(scriptRe);
  if (m) {
    const body = String(m[1] || "");
    const injected = injectIconHelpers(body, iconMap);
    next = next.replace(
      scriptRe,
      `<script setup lang="ts">${injected}</script>`,
    );
  }

  if (next !== before) {
    fs.writeFileSync(targetAbs, next, "utf8");
    console.log(
      `[ui-icon-rewrite] rewrote icons using registry: ${path.relative(ROOT, registryAbs)}`,
    );
  }
}

main();
