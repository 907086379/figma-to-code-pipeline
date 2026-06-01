#!/usr/bin/env node
"use strict";

/**
 * 校验 npm pack 产物 tarball 不含 hard link 条目（否则 registry 415）。
 * 用法：node scripts/publish/verify-tarball-no-hardlinks.cjs [path/to/pkg-version.tgz]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();
const FAIL = 2;

function findDefaultTgz() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const name = String(pkg.name || "").trim();
  const version = String(pkg.version || "").trim();
  const candidate = path.join(ROOT, `${name}-${version}.tgz`);
  if (fs.existsSync(candidate)) return candidate;
  const matches = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".tgz") && f.startsWith(`${name}-`))
    .map((f) => path.join(ROOT, f));
  matches.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return matches[0] || "";
}

function listHardlinkEntries(tgzPath) {
  const abs = path.isAbsolute(tgzPath) ? tgzPath : path.join(ROOT, tgzPath);
  if (!fs.existsSync(abs)) {
    console.error(`[verify-tarball] missing: ${abs}`);
    process.exit(FAIL);
  }
  let listing = "";
  try {
    listing = execSync(`tar -tvf "${abs}"`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    console.error("[verify-tarball] tar -tvf failed:", e.message);
    process.exit(FAIL);
  }
  return listing
    .split(/\r?\n/)
    .filter((line) => /^h/i.test(line.trim()))
    .map((line) => line.trim());
}

function main() {
  const input = (process.argv[2] || "").trim();
  const tgz = input || findDefaultTgz();
  if (!tgz) {
    console.error("[verify-tarball] no .tgz found; run npm pack first");
    process.exit(FAIL);
  }

  const hardlinks = listHardlinkEntries(tgz);
  if (hardlinks.length) {
    console.error(`[verify-tarball] hard links in ${path.basename(tgz)} (npm registry will reject):`);
    hardlinks.forEach((line) => console.error(`  ${line}`));
    console.error("[verify-tarball] fix: npm run prepack  (materialize-pack-files) then npm pack again");
    process.exit(FAIL);
  }
  console.log(`[verify-tarball] ok: no hard links in ${path.basename(tgz)}`);
}

main();
