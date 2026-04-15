/* eslint-disable no-console */

function createProjectConfigService(deps) {
  const {
    fs,
    path,
    ROOT,
    createRequire,
    resolveMaybeAbsolutePath,
    normalizeSlash,
  } = deps;

  /** @type {object | null} null = not loaded yet; after load always an object (possibly empty) */
  let memoProjectConfig = null;
  /** @type {string | null} */
  let memoProjectConfigPath = null;

  function loadProjectConfig() {
    if (memoProjectConfig) {
      return memoProjectConfig;
    }
    const candidates = [];
    if (process.env.FIGMA_CACHE_PROJECT_CONFIG) {
      candidates.push(resolveMaybeAbsolutePath(process.env.FIGMA_CACHE_PROJECT_CONFIG));
    }
    candidates.push(path.join(ROOT, "figma-cache.config.cjs"));
    candidates.push(path.join(ROOT, "figma-cache.config.js"));
    candidates.push(path.join(ROOT, ".figmacacherc.cjs"));
    candidates.push(path.join(ROOT, ".figmacacherc.js"));

    const requireFromRoot = createRequire(path.join(ROOT, "package.json"));

    for (const absPath of candidates) {
      if (!fs.existsSync(absPath)) {
        continue;
      }
      try {
        const mod = requireFromRoot(absPath);
        const cfg = mod && mod.default ? mod.default : mod;
        memoProjectConfig = cfg && typeof cfg === "object" ? cfg : {};
        memoProjectConfigPath = absPath;
        return memoProjectConfig;
      } catch (err) {
        console.error(`[figma-cache] project config failed (${absPath}): ${err.message}`);
      }
    }

    memoProjectConfig = {};
    memoProjectConfigPath = null;
    return memoProjectConfig;
  }

  function runPostEnsureHook(cacheKey, item) {
    if (!item || !item.paths) {
      return;
    }
    const cfg = loadProjectConfig();
    const hooks = cfg && cfg.hooks;
    if (!hooks || typeof hooks.postEnsure !== "function") {
      return;
    }
    const ctx = {
      cacheKey,
      fileKey: item.fileKey,
      nodeId: item.nodeId == null ? null : item.nodeId,
      scope: item.scope,
      url: item.url == null ? "" : String(item.url),
      source: item.source == null ? "" : String(item.source),
      syncedAt: item.syncedAt == null ? "" : String(item.syncedAt),
      completeness: Array.isArray(item.completeness) ? item.completeness : [],
      paths: {
        raw: item.paths.raw,
        spec: item.paths.spec,
        meta: item.paths.meta,
        stateMap: item.paths.stateMap,
      },
      root: ROOT,
    };
    try {
      hooks.postEnsure(ctx);
    } catch (err) {
      console.error(`[figma-cache] hooks.postEnsure: ${err.message}`);
    }
  }

  function getProjectConfigPath() {
    return memoProjectConfigPath ? normalizeSlash(memoProjectConfigPath) : null;
  }

  return {
    loadProjectConfig,
    runPostEnsureHook,
    getProjectConfigPath,
  };
}

module.exports = {
  createProjectConfigService,
};