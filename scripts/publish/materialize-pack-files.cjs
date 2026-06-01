#!/usr/bin/env node
"use strict";

/**
 * Windows：npm pack 会把 NTFS 硬链接写进 tarball，registry 会 415 Hard link is not allowed。
 * 在 prepack 阶段把即将发布的文件「实体化」为独立文件（unlink + 重写内容）。
 * 退出码：0 成功，1 失败（与 verify-tarball / remove-stale 一致）。
 */

const fs = require("fs");
const path = require("path");
const { getPackCandidatePaths } = require("./expand-package-files.cjs");

const ROOT = path.join(__dirname, "..", "..");
const EXIT_FAIL = 1;

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

/**
 * @param {string} rootAbs
 * @param {string} relPath
 * @returns {{ materialized: boolean, error?: string }}
 */
function materializeFileAt(rootAbs, relPath) {
  const abs = path.join(rootAbs, relPath);
  if (!fs.existsSync(abs)) {
    return { materialized: false, error: `missing: ${relPath}` };
  }

  let st;
  try {
    st = fs.statSync(abs);
  } catch (e) {
    return { materialized: false, error: `stat ${relPath}: ${e.message}` };
  }

  if (!st.isFile()) {
    return { materialized: false };
  }

  const nlink = typeof st.nlink === "number" ? st.nlink : 1;
  if (nlink <= 1) {
    return { materialized: false };
  }

  try {
    const buf = fs.readFileSync(abs);
    fs.unlinkSync(abs);
    fs.writeFileSync(abs, buf);
  } catch (e) {
    return { materialized: false, error: `${relPath}: ${e.message}` };
  }

  return { materialized: true };
}

function main() {
  if (process.platform !== "win32") {
    return;
  }

  let pkg;
  try {
    pkg = readPkg();
  } catch (e) {
    console.error("[materialize-pack-files] read package.json failed:", e.message);
    process.exit(EXIT_FAIL);
  }

  let relFiles;
  try {
    relFiles = getPackCandidatePaths(ROOT, pkg);
  } catch (e) {
    console.error("[materialize-pack-files] expand pack paths failed:", e.message);
    process.exit(EXIT_FAIL);
  }

  const materialized = [];
  const errors = [];

  for (const rel of relFiles) {
    const result = materializeFileAt(ROOT, rel);
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    if (result.materialized) {
      materialized.push(rel);
    }
  }

  if (errors.length) {
    console.error("[materialize-pack-files] errors:");
    errors.forEach((msg) => console.error(`  - ${msg}`));
    process.exit(EXIT_FAIL);
  }

  if (materialized.length) {
    console.log("[materialize-pack-files] broke NTFS hard links (required for npm publish on Windows):");
    materialized.forEach((f) => console.log(`  - ${f}`));
  }
}

if (require.main === module) {
  main();
}

module.exports = { materializeFileAt, EXIT_FAIL };
