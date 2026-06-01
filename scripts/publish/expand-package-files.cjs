"use strict";

const fs = require("fs");
const path = require("path");

/** npm pack 在根目录自动纳入的常见文件名（见 npm pack 文档） */
const NPM_AUTO_ROOT_BASENAMES = new Set([
  "package.json",
  "README",
  "README.md",
  "README.markdown",
  "CHANGELOG",
  "CHANGELOG.md",
  "LICENSE",
  "LICENCE",
]);

function posix(p) {
  return p.split(path.sep).join("/");
}

/**
 * @param {string} name package.json name（可含 scope）
 * @returns {string} npm pack 产物 basename 前缀，如 figma-to-code-pipeline- 或 @scope/pkg -> scope-pkg-
 */
function npmPackTarballPrefix(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  const base = trimmed.startsWith("@") ? trimmed.slice(1).replace("/", "-") : trimmed;
  return `${base}-`;
}

/**
 * @param {string} name
 * @param {string} version
 * @returns {string} 例如 figma-to-code-pipeline-4.4.0.tgz 或 my-scope-my-pkg-1.0.0.tgz
 */
function npmPackTarballBasename(name, version) {
  return `${npmPackTarballPrefix(name)}${String(version || "").trim()}.tgz`;
}

/**
 * @param {string} rootAbs
 * @param {Set<string>} acc
 */
function addNpmAutoPackRootFiles(rootAbs, acc) {
  for (const rel of NPM_AUTO_ROOT_BASENAMES) {
    const abs = path.join(rootAbs, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      if (fs.statSync(abs).isFile()) acc.add(rel);
    } catch (e) {
      throw new Error(`stat ${rel}: ${e.message}`);
    }
  }

  let rootNames;
  try {
    rootNames = fs.readdirSync(rootAbs);
  } catch (e) {
    throw new Error(`readdir .: ${e.message}`);
  }

  for (const name of rootNames) {
    if (!/^README\./i.test(name) && !/^CHANGELOG\./i.test(name)) continue;
    const rel = posix(name);
    if (acc.has(rel)) continue;
    const abs = path.join(rootAbs, name);
    try {
      if (fs.statSync(abs).isFile()) acc.add(rel);
    } catch (e) {
      throw new Error(`stat ${rel}: ${e.message}`);
    }
  }
}

/**
 * @param {string} rootAbs
 * @param {string} relDir
 * @param {Set<string>} acc
 * @param {{ extensions?: string[] }} [options] — 若提供则仅收录匹配扩展名（含点，如 ".js"）
 */
function listFilesRecursive(rootAbs, relDir, acc, options = {}) {
  const { extensions } = options;
  const abs = path.join(rootAbs, relDir);
  if (!fs.existsSync(abs)) return;

  let names;
  try {
    names = fs.readdirSync(abs);
  } catch (e) {
    throw new Error(`readdir ${relDir}: ${e.message}`);
  }

  for (const name of names) {
    const rel = posix(path.join(relDir, name));
    let st;
    try {
      st = fs.statSync(path.join(rootAbs, rel));
    } catch (e) {
      throw new Error(`stat ${rel}: ${e.message}`);
    }
    if (st.isDirectory()) {
      listFilesRecursive(rootAbs, rel, acc, options);
      continue;
    }
    if (extensions && extensions.length) {
      const ext = path.extname(rel).toLowerCase();
      if (!extensions.includes(ext)) continue;
    }
    acc.add(rel);
  }
}

/** 单层目录 glob：relDir 下文件名以 suffix 结尾 */
function listGlobBasenames(rootAbs, relDir, suffix, acc) {
  const dir = path.join(rootAbs, relDir);
  if (!fs.existsSync(dir)) return;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    throw new Error(`readdir ${relDir}: ${e.message}`);
  }
  for (const name of names) {
    if (name.endsWith(suffix)) {
      acc.add(posix(path.join(relDir, name)));
    }
  }
}

/**
 * 展开 package.json `files`（手写近似 npm pack 白名单；不含 .npmignore）。
 * 改 `files` 时须同步维护本模块中的 glob 分支。
 * @param {string} rootAbs
 * @param {{ files?: string[] }} pkg
 * @param {{ warnMissingLiterals?: boolean }} [opts]
 * @returns {Set<string>}
 */
function expandFilesField(rootAbs, pkg, opts = {}) {
  const { warnMissingLiterals = false } = opts;
  const out = new Set();
  const files = Array.isArray(pkg.files) ? pkg.files : [];

  for (const entry of files) {
    const e = posix(entry);
    const isGlob = e.includes("*");

    if (e === "scripts/**/*.js") {
      listFilesRecursive(rootAbs, "scripts", out, { extensions: [".js"] });
      continue;
    }
    if (e === "scripts/**/*.cjs") {
      listFilesRecursive(rootAbs, "scripts", out, { extensions: [".cjs"] });
      continue;
    }
    if (e === "figma-cache/adapters/recipes/*.json") {
      listGlobBasenames(rootAbs, "figma-cache/adapters/recipes", ".json", out);
      continue;
    }
    if (e === "figma-cache/docs/*.md") {
      listGlobBasenames(rootAbs, "figma-cache/docs", ".md", out);
      continue;
    }

    const abs = path.join(rootAbs, e);
    if (!fs.existsSync(abs)) {
      if (warnMissingLiterals && !isGlob) {
        console.warn(`[expand-package-files] files entry not found: ${e}`);
      }
      continue;
    }
    let st;
    try {
      st = fs.statSync(abs);
    } catch (err) {
      throw new Error(`stat ${e}: ${err.message}`);
    }
    if (st.isDirectory()) {
      listFilesRecursive(rootAbs, e, out);
    } else {
      out.add(e);
    }
  }

  return out;
}

/**
 * `files` 展开 + npm 自动打包的根文件（供 Windows 实体化与校验）。
 * @param {string} rootAbs
 * @param {{ files?: string[], name?: string }} pkg
 * @returns {Set<string>}
 */
function getPackCandidatePaths(rootAbs, pkg) {
  const out = expandFilesField(rootAbs, pkg);
  addNpmAutoPackRootFiles(rootAbs, out);
  return out;
}

module.exports = {
  expandFilesField,
  getPackCandidatePaths,
  addNpmAutoPackRootFiles,
  listFilesRecursive,
  listGlobBasenames,
  npmPackTarballBasename,
  npmPackTarballPrefix,
  posix,
  NPM_AUTO_ROOT_BASENAMES,
};
