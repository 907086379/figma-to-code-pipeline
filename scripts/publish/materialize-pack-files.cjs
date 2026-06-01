#!/usr/bin/env node
"use strict";

/**
 * Windows：npm pack 会把 NTFS 硬链接写进 tarball，registry 会 415 Hard link is not allowed。
 * 在 prepack 阶段把即将发布的文件「实体化」为独立文件（unlink + 重写内容）。
 */

const fs = require("fs");
const path = require("path");
const { expandFilesField } = require("./expand-package-files.cjs");

const ROOT = path.join(__dirname, "..", "..");

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

function materializeFile(relPath) {
  const abs = path.join(ROOT, relPath);
  const st = fs.statSync(abs);
  if (!st.isFile()) return false;

  const nlink = typeof st.nlink === "number" ? st.nlink : 1;
  if (nlink <= 1) return false;

  const buf = fs.readFileSync(abs);
  fs.unlinkSync(abs);
  fs.writeFileSync(abs, buf);
  return true;
}

function main() {
  if (process.platform !== "win32") {
    return;
  }

  const pkg = readPkg();
  const relFiles = expandFilesField(ROOT, pkg);
  const materialized = [];

  for (const rel of relFiles) {
    if (materializeFile(rel)) {
      materialized.push(rel);
    }
  }

  if (materialized.length) {
    console.log("[materialize-pack-files] broke NTFS hard links (required for npm publish on Windows):");
    materialized.forEach((f) => console.log(`  - ${f}`));
  }
}

main();
