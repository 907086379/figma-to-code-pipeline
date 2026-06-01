#!/usr/bin/env node
"use strict";

/**
 * 删除项目根目录下与当前 package.json 版本不一致的 npm pack 产物，避免误验旧 tgz。
 * 退出码：0 成功，1 读包或删除失败。
 */

const fs = require("fs");
const path = require("path");
const { npmPackTarballBasename, npmPackTarballPrefix } = require("./expand-package-files.cjs");

const EXIT_FAIL = 1;

/**
 * @param {string} rootAbs 项目根（含 package.json）
 * @param {{ name?: string, version?: string }} pkg
 * @param {{ log?: boolean }} [opts]
 */
function removeStalePackTgz(rootAbs, pkg, opts = {}) {
  const log = opts.log !== false;
  const name = String(pkg.name || "").trim();
  const version = String(pkg.version || "").trim();
  if (!name || !version) {
    if (log) {
      console.warn("[remove-stale-pack-tgz] skip: package.json missing name or version");
    }
    return;
  }

  const keep = npmPackTarballBasename(name, version);
  const prefix = npmPackTarballPrefix(name);
  const errors = [];

  for (const f of fs.readdirSync(rootAbs)) {
    if (!f.endsWith(".tgz") || !f.startsWith(prefix) || f === keep) continue;
    try {
      fs.unlinkSync(path.join(rootAbs, f));
      if (log) console.log(`[remove-stale-pack-tgz] removed ${f}`);
    } catch (e) {
      errors.push(`${f}: ${e.message}`);
    }
  }

  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.code = "REMOVE_STALE_FAILED";
    throw err;
  }
}

function main() {
  const root = process.cwd();
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch (e) {
    console.error("[remove-stale-pack-tgz] read package.json failed:", e.message);
    process.exit(EXIT_FAIL);
  }

  try {
    removeStalePackTgz(root, pkg);
  } catch (e) {
    console.error("[remove-stale-pack-tgz] delete failed:", e.message);
    process.exit(EXIT_FAIL);
  }
}

if (require.main === module) {
  main();
}

module.exports = { removeStalePackTgz, EXIT_FAIL };
