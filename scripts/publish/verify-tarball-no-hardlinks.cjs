#!/usr/bin/env node
"use strict";

/**
 * 校验 npm pack 产物 tarball 不含 hard link 条目（否则 registry 415）。
 * 依赖 tar 的 `tar -tvf` 列表首列为类型位（bsdtar/GNU 硬链接为 `h` 开头）。
 * 用法：node scripts/publish/verify-tarball-no-hardlinks.cjs [path/to/pkg-version.tgz]
 * 退出码：0 成功，1 失败。
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { npmPackTarballBasename, npmPackTarballPrefix } = require("./expand-package-files.cjs");

const EXIT_FAIL = 1;

/**
 * @param {string} rootAbs
 * @param {{ name?: string, version?: string }} pkg
 * @returns {{ status: 'found', path: string } | { status: 'missing_meta' } | { status: 'not_found', expectedBase: string } | { status: 'stale', expectedBase: string, stale: string[] }}
 */
function resolveExpectedTgz(rootAbs, pkg) {
  const name = String(pkg.name || "").trim();
  const version = String(pkg.version || "").trim();
  if (!name || !version) {
    return { status: "missing_meta" };
  }

  const expectedBase = npmPackTarballBasename(name, version);
  const candidate = path.join(rootAbs, expectedBase);
  if (fs.existsSync(candidate)) {
    return { status: "found", path: candidate };
  }

  const stale = fs
    .readdirSync(rootAbs)
    .filter((f) => f.endsWith(".tgz") && f.startsWith(npmPackTarballPrefix(name)));

  if (stale.length) {
    return { status: "stale", expectedBase, stale };
  }

  return { status: "not_found", expectedBase };
}

function failResolve(result) {
  if (result.status === "missing_meta") {
    console.error("[verify-tarball] package.json missing name or version");
    process.exit(EXIT_FAIL);
  }
  if (result.status === "stale") {
    console.error(`[verify-tarball] expected ${result.expectedBase} (from package.json)`);
    console.error("[verify-tarball] stale .tgz in project root (remove or run npm run publish:win):");
    result.stale.forEach((f) => console.error(`  - ${f}`));
    process.exit(EXIT_FAIL);
  }
  if (result.status === "not_found") {
    return "";
  }
  return "";
}

function listHardlinkEntries(rootAbs, tgzPath) {
  const abs = path.isAbsolute(tgzPath) ? tgzPath : path.join(rootAbs, tgzPath);
  if (!fs.existsSync(abs)) {
    console.error(`[verify-tarball] missing: ${abs}`);
    process.exit(EXIT_FAIL);
  }
  let listing = "";
  try {
    listing = execFileSync("tar", ["-tvf", abs], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    let tarHint = "";
    try {
      tarHint = execFileSync("tar", ["--version"], { encoding: "utf8" }).split(/\r?\n/)[0];
    } catch {
      tarHint = "(tar not in PATH)";
    }
    console.error("[verify-tarball] tar -tvf failed:", e.message);
    console.error(`[verify-tarball] tar: ${tarHint}`);
    if (e && e.code === "ENOENT") {
      console.error("[verify-tarball] install tar (e.g. Git for Windows) and ensure it is on PATH");
    }
    process.exit(EXIT_FAIL);
  }
  return listing
    .split(/\r?\n/)
    .filter((line) => /^h/i.test(line.trim()))
    .map((line) => line.trim());
}

function main() {
  const root = process.cwd();
  const input = (process.argv[2] || "").trim();

  let tgz = input;
  if (!tgz) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    } catch (e) {
      console.error("[verify-tarball] read package.json failed:", e.message);
      process.exit(EXIT_FAIL);
    }
    const resolved = resolveExpectedTgz(root, pkg);
    if (resolved.status === "found") {
      tgz = resolved.path;
    } else {
      tgz = failResolve(resolved);
    }
  }

  if (!tgz) {
    console.error("[verify-tarball] no .tgz found; run npm pack first");
    process.exit(EXIT_FAIL);
  }

  const hardlinks = listHardlinkEntries(root, tgz);
  if (hardlinks.length) {
    console.error(`[verify-tarball] hard links in ${path.basename(tgz)} (npm registry will reject):`);
    hardlinks.forEach((line) => console.error(`  ${line}`));
    console.error("[verify-tarball] fix: npm run prepack && npm pack");
    process.exit(EXIT_FAIL);
  }
  console.log(`[verify-tarball] ok: no hard links in ${path.basename(tgz)}`);
}

if (require.main === module) {
  main();
}

module.exports = { resolveExpectedTgz, listHardlinkEntries, EXIT_FAIL };
