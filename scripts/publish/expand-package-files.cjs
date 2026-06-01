"use strict";

const fs = require("fs");
const path = require("path");

function posix(p) {
  return p.split(path.sep).join("/");
}

function listFilesRecursive(rootAbs, relDir, acc) {
  const abs = path.join(rootAbs, relDir);
  if (!fs.existsSync(abs)) return;
  for (const name of fs.readdirSync(abs)) {
    const rel = posix(path.join(relDir, name));
    const st = fs.statSync(path.join(rootAbs, rel));
    if (st.isDirectory()) {
      listFilesRecursive(rootAbs, rel, acc);
    } else {
      acc.add(rel);
    }
  }
}

function expandFilesField(rootAbs, pkg) {
  const out = new Set();
  const files = Array.isArray(pkg.files) ? pkg.files : [];

  for (const entry of files) {
    const e = posix(entry);
    if (e === "figma-cache/js/*.js") {
      const dir = path.join(rootAbs, "figma-cache", "js");
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".js")) out.add(`figma-cache/js/${name}`);
      }
      continue;
    }
    if (e === "scripts/**/*.js" || e === "scripts/**/*.cjs") {
      listFilesRecursive(rootAbs, "scripts", out);
      continue;
    }
    if (e === "figma-cache/adapters/recipes/*.json") {
      const dir = path.join(rootAbs, "figma-cache", "adapters", "recipes");
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".json")) out.add(`figma-cache/adapters/recipes/${name}`);
      }
      continue;
    }
    if (e === "figma-cache/docs/*.md") {
      const dir = path.join(rootAbs, "figma-cache", "docs");
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".md")) out.add(`figma-cache/docs/${name}`);
      }
      continue;
    }

    const abs = path.join(rootAbs, e);
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      listFilesRecursive(rootAbs, e, out);
    } else {
      out.add(e);
    }
  }

  return out;
}

module.exports = { expandFilesField, listFilesRecursive };
