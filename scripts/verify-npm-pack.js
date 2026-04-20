#!/usr/bin/env node
/**
 * 根据 package.json 的 `files` 在本地展开可发布路径（与当前白名单一致），
 * 校验关键文件存在；不调用 `npm pack`，避免 prepack 递归。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

function posix(p) {
  return p.split(path.sep).join("/");
}

function listFilesRecursive(relDir, acc) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) {
    return;
  }
  for (const name of fs.readdirSync(abs)) {
    const rel = posix(path.join(relDir, name));
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) {
      listFilesRecursive(rel, acc);
    } else {
      acc.add(rel);
    }
  }
}

function expandFilesField(pkg) {
  const out = new Set();
  const files = Array.isArray(pkg.files) ? pkg.files : [];

  for (const entry of files) {
    const e = posix(entry);
    if (e === "figma-cache/js/*.js") {
      const dir = path.join(ROOT, "figma-cache", "js");
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".js")) {
          out.add(`figma-cache/js/${name}`);
        }
      }
      continue;
    }
    if (e === "scripts/*.js") {
      const dir = path.join(ROOT, "scripts");
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".js") && !fs.statSync(path.join(dir, name)).isDirectory()) {
          out.add(`scripts/${name}`);
        }
      }
      continue;
    }
    if (e === "scripts/*.cjs") {
      const dir = path.join(ROOT, "scripts");
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".cjs")) {
          out.add(`scripts/${name}`);
        }
      }
      continue;
    }
    if (e === "figma-cache/adapters/recipes/*.json") {
      const dir = path.join(ROOT, "figma-cache", "adapters", "recipes");
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".json")) {
          out.add(`figma-cache/adapters/recipes/${name}`);
        }
      }
      continue;
    }
    if (e === "figma-cache/docs/*.md") {
      const dir = path.join(ROOT, "figma-cache", "docs");
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".md")) {
          out.add(`figma-cache/docs/${name}`);
        }
      }
      continue;
    }

    const abs = path.join(ROOT, e);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      listFilesRecursive(e, out);
    } else {
      out.add(e);
    }
  }

  return out;
}

const REQUIRED = [
  "bin/figma-cache.js",
  "figma-cache/figma-cache.js",
  "figma-cache/js/validate-cli.js",
  "scripts/generate-icon-insets-from-batch.cjs",
  "scripts/generate-icon-insets.cjs",
  "scripts/forbidden-markup-check.cjs",
  "scripts/check-cursor-shadow.js",
  "scripts/check-doc-encoding.js",
  "scripts/mobile/generate-mobile-spec.js",
  "cursor-bootstrap/managed-files.json",
];

function main() {
  const pkg = readPkg();
  const packed = expandFilesField(pkg);
  const missing = REQUIRED.filter((p) => !packed.has(p));
  if (missing.length) {
    console.error("[verify:pack] not covered by expanded `files`:");
    missing.forEach((m) => console.error(`  - ${m}`));
    process.exit(1);
  }
  for (const p of REQUIRED) {
    if (!fs.existsSync(path.join(ROOT, p))) {
      console.error(`[verify:pack] missing on disk: ${p}`);
      process.exit(1);
    }
  }
  console.log(`[verify:pack] OK (${packed.size} packed path(s), ${REQUIRED.length} required)`);
}

main();
