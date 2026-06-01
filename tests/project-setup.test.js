#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  evaluateProjectSetup,
  finishProjectSetup,
  ensurePendingProjectSetupManifest,
} = require("../figma-cache/js/project-setup");

function mkTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fc-project-setup-"));
}

function writeAdapter(fs, root, name) {
  const dir = path.join(root, ".cursor", "rules");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), "---\ndescription: test\n---\n", "utf8");
}

function run() {
  const root = mkTemp();
  const cacheDir = path.join(root, "figma-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(
    path.join(root, "figma-cache.config.cjs"),
    "module.exports = { hooks: {} };\n",
    "utf8",
  );

  writeAdapter(fs, root, "02-figma-vue3-vite-tailwind-adapter.mdc");

  const deps = {
    fs,
    path,
    root,
    cacheDir,
    loadProjectConfig: () => ({}),
    getProjectConfigPath: () => path.join(root, "figma-cache.config.cjs"),
  };

  ensurePendingProjectSetupManifest(deps);
  let report = evaluateProjectSetup(deps, { requireManifestComplete: true });
  assert.strictEqual(report.ok, false, "pending manifest should fail strict check");

  const fin = finishProjectSetup(deps);
  assert.strictEqual(fin.ok, true);
  report = evaluateProjectSetup(deps);
  assert.strictEqual(report.ok, true);

  writeAdapter(fs, root, "02-figma-stack-adapter.mdc");
  report = evaluateProjectSetup(deps, { requireManifestComplete: false });
  assert.strictEqual(report.ok, false);

  console.log("project-setup.test.js: ok");
}

run();
