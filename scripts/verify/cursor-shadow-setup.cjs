"use strict";

const fs = require("fs");
const path = require("path");

const STACK_ADAPTER_MIRROR = ".cursor/rules/02-figma-stack-adapter.mdc";

function readSetupManifest(projectRoot) {
  const cacheDir = process.env.FIGMA_CACHE_DIR || "figma-cache";
  const abs = path.join(projectRoot, cacheDir, "project-setup.manifest.json");
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function isSetupComplete(projectRoot) {
  const manifest = readSetupManifest(projectRoot);
  return Boolean(manifest && manifest.status === "complete");
}

/**
 * setup 未完成时保留 stack 占位镜像；完成后才删除。
 * @param {string[]} retired
 * @param {boolean} setupComplete
 */
function effectiveRetiredFiles(retired, setupComplete) {
  const out = retired.filter(
    (relPath) => !(relPath === STACK_ADAPTER_MIRROR && !setupComplete),
  );
  if (setupComplete && !out.includes(STACK_ADAPTER_MIRROR)) {
    out.push(STACK_ADAPTER_MIRROR);
  }
  return out;
}

function shouldSkipStackAdapterMirror(to, setupComplete) {
  return setupComplete && to === STACK_ADAPTER_MIRROR;
}

module.exports = {
  STACK_ADAPTER_MIRROR,
  readSetupManifest,
  isSetupComplete,
  effectiveRetiredFiles,
  shouldSkipStackAdapterMirror,
};
