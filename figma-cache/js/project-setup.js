/* eslint-disable no-console */

const MANIFEST_BASENAME = "project-setup.manifest.json";
const PLACEHOLDER_ADAPTER = "02-figma-stack-adapter.mdc";
const STACK_ADAPTER_RE = /^02-figma-.+-adapter\.mdc$/;

/**
 * @param {string} cacheDirAbs
 * @returns {string}
 */
function getManifestAbsPath(cacheDirAbs) {
  const path = require("path");
  return path.join(cacheDirAbs, MANIFEST_BASENAME);
}

/**
 * @param {import('fs')} fs
 * @param {string} cacheDirAbs
 * @returns {object | null}
 */
function readManifest(fs, cacheDirAbs) {
  const abs = getManifestAbsPath(cacheDirAbs);
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {import('fs')} fs
 * @param {string} cacheDirAbs
 * @param {object} body
 */
function writeManifest(fs, cacheDirAbs, body) {
  const path = require("path");
  const abs = getManifestAbsPath(cacheDirAbs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/**
 * @param {import('fs')} fs
 * @param {import('path')} path
 * @param {string} root
 * @returns {string[]}
 */
function listStackAdapterRules(fs, path, root) {
  const rulesDir = path.join(root, ".cursor", "rules");
  if (!fs.existsSync(rulesDir)) {
    return [];
  }
  return fs
    .readdirSync(rulesDir)
    .filter((name) => STACK_ADAPTER_RE.test(name) && name !== PLACEHOLDER_ADAPTER);
}

/**
 * @param {object} deps
 * @param {{ requireManifestComplete?: boolean }} [options]
 * @returns {{ ok: boolean, errors: string[], warnings: string[], stackAdapters: string[], manifest: object | null, projectConfigPath: string | null }}
 */
function evaluateProjectSetup(deps, options) {
  const requireManifestComplete = !(options && options.requireManifestComplete === false);
  const { fs, path, root, cacheDir, loadProjectConfig, getProjectConfigPath } = deps;
  const errors = [];
  const warnings = [];

  const rulesDir = path.join(root, ".cursor", "rules");
  const placeholderPath = path.join(rulesDir, PLACEHOLDER_ADAPTER);
  if (fs.existsSync(placeholderPath)) {
    errors.push(
      `Remove placeholder rule: .cursor/rules/${PLACEHOLDER_ADAPTER} (run AGENT-SETUP / figma-cache project-setup finish)`,
    );
  }

  const stackAdapters = listStackAdapterRules(fs, path, root);
  if (!stackAdapters.length) {
    errors.push(
      "Missing stack adapter rule: .cursor/rules/02-figma-<stack>-adapter.mdc (complete AGENT-SETUP step 5)",
    );
  }

  if (fs.existsSync(path.join(root, "AGENT-SETUP-PROMPT.md"))) {
    warnings.push(
      "AGENT-SETUP-PROMPT.md still at repo root; safe to delete after project-setup finish",
    );
  }

  loadProjectConfig();
  const projectConfigPath = getProjectConfigPath ? getProjectConfigPath() : null;
  if (!projectConfigPath) {
    errors.push(
      "Project config not loadable: add figma-cache.config.cjs (ESM repos) or figma-cache.config.js",
    );
  }

  const manifest = readManifest(fs, cacheDir);
  if (requireManifestComplete && (!manifest || manifest.status !== "complete")) {
    errors.push(
      `${MANIFEST_BASENAME} missing or status !== "complete"; run: figma-cache project-setup finish`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stackAdapters,
    manifest,
    projectConfigPath,
  };
}

/**
 * @param {object} deps
 * @returns {{ ok: boolean, manifest: object, report: ReturnType<typeof evaluateProjectSetup> }}
 */
function finishProjectSetup(deps) {
  const { fs, cacheDir } = deps;
  const report = evaluateProjectSetup(deps, { requireManifestComplete: false });
  if (!report.ok) {
    return { ok: false, manifest: null, report };
  }

  const manifest = {
    schemaVersion: 1,
    status: "complete",
    completedAt: new Date().toISOString(),
    stackAdapterRules: report.stackAdapters.map((name) => `.cursor/rules/${name}`),
    projectConfig: report.projectConfigPath
      ? report.projectConfigPath.replace(/\\/g, "/")
      : null,
    forbiddenPlaceholders: [`.cursor/rules/${PLACEHOLDER_ADAPTER}`],
  };

  writeManifest(fs, cacheDir, manifest);
  return { ok: true, manifest, report };
}

/**
 * @param {object} deps
 * @returns {object}
 */
function ensurePendingProjectSetupManifest(deps) {
  const { fs, cacheDir } = deps;
  const existing = readManifest(fs, cacheDir);
  if (existing && existing.status === "complete") {
    return existing;
  }
  const manifest = {
    schemaVersion: 1,
    status: "pending",
    createdAt: new Date().toISOString(),
    note: "Run figma-cache project-setup finish after AGENT-SETUP (stack adapter + config).",
  };
  writeManifest(fs, cacheDir, manifest);
  return manifest;
}

/**
 * @param {import('fs')} fs
 * @param {import('path')} path
 * @param {string} root
 * @returns {boolean}
 */
function projectUsesEsmModules(fs, path, root) {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg && pkg.type === "module";
  } catch {
    return false;
  }
}

module.exports = {
  MANIFEST_BASENAME,
  PLACEHOLDER_ADAPTER,
  getManifestAbsPath,
  readManifest,
  writeManifest,
  listStackAdapterRules,
  evaluateProjectSetup,
  finishProjectSetup,
  ensurePendingProjectSetupManifest,
  projectUsesEsmModules,
};
