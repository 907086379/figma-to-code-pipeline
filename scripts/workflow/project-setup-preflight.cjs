#!/usr/bin/env node
"use strict";

const path = require("path");
const { createRequire } = require("module");

/**
 * @param {{ root?: string, cacheDirRel?: string, requireComplete?: boolean }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
function assertProjectSetupPreflight(options) {
  const root = (options && options.root) || process.cwd();
  const cacheDirRel = (options && options.cacheDirRel) || process.env.FIGMA_CACHE_DIR || "figma-cache";
  const fs = require("fs");
  const cacheDir = path.isAbsolute(cacheDirRel)
    ? cacheDirRel
    : path.join(root, cacheDirRel);

  const projectSetup = require(path.join(__dirname, "../../figma-cache/js/project-setup"));
  const requireFromRoot = createRequire(path.join(root, "package.json"));

  function loadProjectConfig() {
    const candidates = [
      path.join(root, "figma-cache.config.cjs"),
      path.join(root, "figma-cache.config.js"),
    ];
    for (const abs of candidates) {
      if (!fs.existsSync(abs)) continue;
      try {
        const mod = requireFromRoot(abs);
        return mod && mod.default ? mod.default : mod;
      } catch {
        return null;
      }
    }
    return null;
  }

  function getProjectConfigPath() {
    for (const name of ["figma-cache.config.cjs", "figma-cache.config.js"]) {
      const abs = path.join(root, name);
      if (fs.existsSync(abs)) {
        try {
          requireFromRoot(abs);
          return abs;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  const report = projectSetup.evaluateProjectSetup(
    {
      fs,
      path,
      root,
      cacheDir,
      loadProjectConfig,
      getProjectConfigPath,
    },
    { requireManifestComplete: options && options.requireComplete !== false },
  );

  return { ok: report.ok, errors: report.errors };
}

module.exports = { assertProjectSetupPreflight };
