#!/usr/bin/env node
/**
 * 根据 package.json 的 `files` 在本地展开可发布路径（与当前白名单一致），
 * 校验关键文件存在；不调用 `npm pack`，避免 prepack 递归。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { getPackCandidatePaths } = require("../publish/expand-package-files.cjs");

const ROOT = path.join(__dirname, "..", "..");
const EXIT_FAIL = 1;

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

const REQUIRED = [
  "bin/figma-cache.js",
  "figma-cache/figma-cache.js",
  "figma-cache/js/validate-cli.js",
  "scripts/batch-add.cjs",
  "scripts/workflow/batch-remove.cjs",
  "scripts/workflow/mcp-ingest-argv.cjs",
  "scripts/generate-icon-insets.cjs",
  "scripts/forbidden-markup-check.cjs",
  "scripts/verify/check-cursor-shadow.js",
  "scripts/verify/check-doc-encoding.js",
  "scripts/mobile/generate-mobile-spec.js",
  "cursor-bootstrap/managed-files.json",
];

function main() {
  const pkg = readPkg();
  const packed = getPackCandidatePaths(ROOT, pkg);
  const missing = REQUIRED.filter((p) => !packed.has(p));
  if (missing.length) {
    console.error("[verify:pack] not covered by expanded `files`:");
    missing.forEach((m) => console.error(`  - ${m}`));
    process.exit(EXIT_FAIL);
  }
  for (const p of REQUIRED) {
    if (!fs.existsSync(path.join(ROOT, p))) {
      console.error(`[verify:pack] missing on disk: ${p}`);
      process.exit(EXIT_FAIL);
    }
  }
  console.log(`[verify:pack] OK (${packed.size} packed path(s), ${REQUIRED.length} required)`);
}

main();
