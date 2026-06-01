"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_UI_BATCH_PROFILE = "vue3-vite-auto-routes-tailwind";
const DEFAULT_UI_BATCH_ROOT = "./src/components/figma-batch";
const DEFAULT_UI_BATCH_MOUNT_MODE = "manual";
const DEFAULT_UI_BATCH_CONFIG = "figma-ui-batch.config.json";

/** @deprecated 旧版 batch-add 默认目录（仅用于 deprecate 提示） */
const LEGACY_TARGET_ROOT = "./src/pages/main/components";
const LEGACY_TARGET_ROOT_PREFIXES = [
  "./src/pages/main/components",
  "./src/pages/main",
  "src/pages/main/components",
  "src/pages/main",
];

const UI_BATCH_PROFILE_PRESETS = {
  "vue3-vite-auto-routes-tailwind": {
    targetRoot: DEFAULT_UI_BATCH_ROOT,
    targetTemplate: "{targetRoot}/{component}/index.vue",
    mountPageCandidates: [
      "./src/pages/figma-preview.vue",
      "./src/pages/main/index.vue",
      "./src/pages/index.vue",
    ],
  },
  "vue3-standard": {
    targetRoot: "./src/ui/components",
    targetTemplate: "{targetRoot}/{component}/index.vue",
    mountPageCandidates: ["./src/pages/figma-preview.vue", "./src/pages/index.vue", "./src/App.vue"],
  },
  react: {
    targetRoot: "./src/components/figma-batch",
    targetTemplate: "{targetRoot}/{component}/index.tsx",
    mountPageCandidates: ["./src/pages/figma-preview.tsx", "./src/App.tsx"],
  },
  html: {
    targetRoot: "./figma-html",
    targetTemplate: "{targetRoot}/{component}.fragment.html",
    mountPageCandidates: ["./public/figma-preview.html", "./figma-preview.html"],
  },
};

function readJsonIfExists(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function readUiBatchConfig(projectRoot) {
  const root = projectRoot || process.cwd();
  const configPath = path.join(root, DEFAULT_UI_BATCH_CONFIG);
  const raw = readJsonIfExists(configPath);
  if (!raw || typeof raw !== "object") {
    return { path: DEFAULT_UI_BATCH_CONFIG, exists: false, config: null };
  }
  const config = raw.uiBatch && typeof raw.uiBatch === "object" ? raw.uiBatch : raw;
  return {
    path: DEFAULT_UI_BATCH_CONFIG,
    exists: true,
    config: config && typeof config === "object" ? config : null,
  };
}

function normalizeMountMode(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (!value) return DEFAULT_UI_BATCH_MOUNT_MODE;
  if (value === "off" || value === "none" || value === "disable" || value === "disabled") return "off";
  if (value === "manual" || value === "skip") return "manual";
  if (value === "auto") return "auto";
  return DEFAULT_UI_BATCH_MOUNT_MODE;
}

const STRICT_BLOCKING_FINDINGS = new Set([
  "target-root-in-pages",
  "auto-routes-risk",
  "mount-page-not-found",
]);

function normalizeProfile(raw, kind) {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (value) return value;
  const k = String(kind || "").trim().toLowerCase();
  if (k === "react") return "react";
  if (k === "html") return "html";
  return DEFAULT_UI_BATCH_PROFILE;
}

function resolveUiBatchProfile(config, argsProfile, kind) {
  const requested = normalizeProfile(
    argsProfile ||
      process.env.FIGMA_UI_BATCH_PROFILE ||
      (config && config.profile ? config.profile : ""),
    kind
  );
  if (UI_BATCH_PROFILE_PRESETS[requested]) {
    return { name: requested, preset: UI_BATCH_PROFILE_PRESETS[requested], fallback: false };
  }
  const fallbackPreset = UI_BATCH_PROFILE_PRESETS[DEFAULT_UI_BATCH_PROFILE];
  return {
    name: requested,
    preset: fallbackPreset,
    fallback: true,
    fallbackTo: DEFAULT_UI_BATCH_PROFILE,
  };
}

function normalizeRelativePath(input) {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  return raw.startsWith("./") ? raw : `./${raw}`;
}

function normalizeTargetRoot(input) {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  const normalized = raw.startsWith("./") ? raw : `./${raw}`;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function candidateExists(projectRoot, relPath) {
  const safe = normalizeRelativePath(relPath);
  if (!safe) return false;
  const abs = path.isAbsolute(safe) ? safe : path.join(projectRoot || process.cwd(), safe);
  return fs.existsSync(abs);
}

function isTargetRootUnderPages(targetRoot) {
  const root = normalizeTargetRoot(targetRoot);
  if (!root) return false;
  return /^\.\/src\/pages(\/|$)/.test(root);
}

function isLegacyTargetRoot(targetRoot) {
  const root = normalizeTargetRoot(targetRoot);
  if (!root) return false;
  return LEGACY_TARGET_ROOT_PREFIXES.some((prefix) => {
    const p = normalizeTargetRoot(prefix);
    return root === p || root.startsWith(`${p}/`);
  });
}

function collectTargetDeprecationWarnings({ targetRoot, targetEntry, explicitTarget }) {
  const warnings = [];
  const root = normalizeTargetRoot(targetRoot);
  const entry = String(targetEntry || "").replace(/\\/g, "/");

  if (isLegacyTargetRoot(root)) {
    warnings.push(
      `[batch-add] deprecate: targetRoot "${root}" 位于旧默认 src/pages/main/**，auto-routes 项目建议改为 ${DEFAULT_UI_BATCH_ROOT}（见 figma-ui-batch.config.json / npm run fc:doctor）。`
    );
  } else if (isTargetRootUnderPages(root)) {
    warnings.push(
      `[batch-add] deprecate: targetRoot "${root}" 落在 src/pages/**，可能触发路由文件冲突；建议 ${DEFAULT_UI_BATCH_ROOT}。`
    );
  }

  if (!explicitTarget && entry.includes("/src/pages/main/components/")) {
    warnings.push(
      `[batch-add] deprecate: target.entry 仍指向 src/pages/main/components/**；新默认应为 ${DEFAULT_UI_BATCH_ROOT}/<Component>/index.vue。`
    );
  }

  return warnings;
}

function detectMountPage(projectRoot, config, preset, kind) {
  const configured = normalizeRelativePath(config && config.mountPage ? config.mountPage : "");
  if (configured) {
    return { mountPage: configured, from: "config", exists: candidateExists(projectRoot, configured) };
  }

  const envMount = normalizeRelativePath(process.env.FIGMA_UI_BATCH_MOUNT_PAGE || "");
  if (envMount) {
    return { mountPage: envMount, from: "env", exists: candidateExists(projectRoot, envMount) };
  }

  const candidates = Array.isArray(preset && preset.mountPageCandidates) ? preset.mountPageCandidates : [];
  const normalizedCandidates = candidates.map((x) => normalizeRelativePath(x)).filter(Boolean);
  const firstExisting = normalizedCandidates.find((x) => candidateExists(projectRoot, x));
  if (firstExisting) {
    return { mountPage: firstExisting, from: "profile-detected", exists: true };
  }

  if (normalizedCandidates.length > 0) {
    return { mountPage: normalizedCandidates[0], from: "profile-fallback", exists: false };
  }

  const byKind =
    String(kind || "").trim() === "html" ? "./public/figma-preview.html" : "./src/pages/figma-preview.vue";
  return { mountPage: byKind, from: "kind-fallback", exists: candidateExists(projectRoot, byKind) };
}

/**
 * batch-add：解析 target.entry（更新已有 case 时避免静默漂移）。
 * @param {{
 *   existingCase?: { target?: { entry?: string } } | null,
 *   explicitTarget?: boolean,
 *   explicitTargetRoot?: boolean,
 *   explicitTargetValue?: string,
 *   resolvedFromTemplate: { entry: string, targetRoot: string },
 * }} params
 * @returns {{ entry: string, source: "preserve-existing"|"explicit-migrate"|"resolved-default", targetRootForWarn: string }}
 */
function resolveBatchTargetEntry(params) {
  const existingCase = params && params.existingCase ? params.existingCase : null;
  const explicitTarget = !!(params && params.explicitTarget);
  const explicitTargetRoot = !!(params && params.explicitTargetRoot);
  const explicitTargetValue = String((params && params.explicitTargetValue) || "").trim();
  const resolved = params && params.resolvedFromTemplate ? params.resolvedFromTemplate : { entry: "", targetRoot: "" };
  const migrateTarget = explicitTarget || explicitTargetRoot;
  const existingEntry =
    existingCase && existingCase.target && String(existingCase.target.entry || "").trim()
      ? String(existingCase.target.entry).trim()
      : "";

  if (!migrateTarget && existingEntry) {
    return { entry: existingEntry, source: "preserve-existing", targetRootForWarn: "" };
  }

  const entry = explicitTargetValue || String(resolved.entry || "").trim();
  return {
    entry,
    source: migrateTarget ? "explicit-migrate" : "resolved-default",
    targetRootForWarn: explicitTargetValue ? "" : String(resolved.targetRoot || "").trim(),
  };
}

function resolveMountStrategy(projectRoot, config, preset, kind, argsMountMode) {
  const mountMode = normalizeMountMode(
    argsMountMode ||
      process.env.FIGMA_UI_BATCH_MOUNT_MODE ||
      (config && (config.mountMode || config.mount) ? config.mountMode || config.mount : "")
  );

  if (mountMode !== "auto") {
    return {
      enabled: false,
      mountMode,
      mountPage: "",
      from: mountMode,
      exists: false,
    };
  }

  const mount = detectMountPage(projectRoot, config, preset, kind);
  return {
    enabled: true,
    mountMode,
    mountPage: mount.mountPage,
    from: mount.from,
    exists: mount.exists,
  };
}

function buildUiBatchDoctorReport(projectRoot, input) {
  const root = projectRoot || process.cwd();
  const config = input && input.config && typeof input.config === "object" ? input.config : {};
  const uiBatchExists = !!(input && input.uiBatchExists);
  const framework = String((input && input.framework) || "unknown");
  const routeMode = String((input && input.routeMode) || "unknown");
  const kind = String((input && input.kind) || "vue").trim() || "vue";

  const profileWrap = resolveUiBatchProfile(
    config,
    (input && input.profile) || process.env.FIGMA_UI_BATCH_PROFILE || "",
    kind
  );
  const profile = profileWrap.fallback ? profileWrap.fallbackTo : profileWrap.name;
  const targetRoot = normalizeRelativePath(
    (config && config.targetRoot) || profileWrap.preset.targetRoot || DEFAULT_UI_BATCH_ROOT
  );
  const targetTemplate = String(
    (config && config.targetTemplate) || profileWrap.preset.targetTemplate || "{targetRoot}/{component}/index.vue"
  ).trim();
  const mountMode = normalizeMountMode(
    (input && input.mountMode) ||
      process.env.FIGMA_UI_BATCH_MOUNT_MODE ||
      (config && (config.mountMode || config.mount) ? config.mountMode || config.mount : "")
  );

  let mountPage = "";
  let mountPageExists = null;
  let mountDetectFrom = "";
  if (mountMode === "auto") {
    const detected = detectMountPage(root, config, profileWrap.preset, kind);
    mountPage = detected.mountPage;
    mountPageExists = detected.exists;
    mountDetectFrom = detected.from;
  }

  const advisories = [];
  const findings = [];
  if (!uiBatchExists) advisories.push("missing-ui-batch-config");
  if (isTargetRootUnderPages(targetRoot)) findings.push("target-root-in-pages");
  if (mountMode === "auto" && mountPageExists === false) findings.push("mount-page-not-found");
  if (framework === "vue" && routeMode === "vue-router-auto-routes" && isTargetRootUnderPages(targetRoot)) {
    findings.push("auto-routes-risk");
  }

  const recommendations = [];
  if (advisories.includes("missing-ui-batch-config")) {
    recommendations.push("create-figma-ui-batch-config");
    recommendations.push("copy-template:cursor-bootstrap/examples/figma-ui-batch.config.vue3-vite-auto-routes.template.json");
  }
  if (findings.includes("target-root-in-pages") || findings.includes("auto-routes-risk")) {
    recommendations.push(`set-targetRoot:${DEFAULT_UI_BATCH_ROOT}`);
  }
  if (mountMode === "auto" && findings.includes("mount-page-not-found")) {
    recommendations.push(`set-mountPage:${mountPage || "./src/pages/figma-preview.vue"}`);
  }
  if (!String(config.mountMode || config.mount || "").trim()) {
    recommendations.push(`set-mountMode:${DEFAULT_UI_BATCH_MOUNT_MODE}`);
  }
  if (!String(config.profile || "").trim()) {
    recommendations.push(`set-profile:${DEFAULT_UI_BATCH_PROFILE}`);
  }
  if (profileWrap.fallback) {
    recommendations.push(`fix-profile:unknown "${profileWrap.name}" -> ${profileWrap.fallbackTo}`);
  }

  const blockingFindings = findings.filter((f) => STRICT_BLOCKING_FINDINGS.has(f));

  return {
    profileWrap,
    profile,
    targetRoot,
    targetTemplate,
    mountMode,
    mountPage,
    mountPageExists,
    mountDetectFrom,
    advisories,
    findings,
    blockingFindings,
    recommendations,
    ok: blockingFindings.length === 0,
    fullyOk: advisories.length === 0 && findings.length === 0,
  };
}

module.exports = {
  DEFAULT_UI_BATCH_PROFILE,
  DEFAULT_UI_BATCH_ROOT,
  DEFAULT_UI_BATCH_MOUNT_MODE,
  LEGACY_TARGET_ROOT,
  UI_BATCH_PROFILE_PRESETS,
  readUiBatchConfig,
  normalizeMountMode,
  normalizeProfile,
  resolveUiBatchProfile,
  normalizeRelativePath,
  normalizeTargetRoot,
  candidateExists,
  isTargetRootUnderPages,
  isLegacyTargetRoot,
  collectTargetDeprecationWarnings,
  detectMountPage,
  resolveMountStrategy,
  resolveBatchTargetEntry,
  STRICT_BLOCKING_FINDINGS,
  buildUiBatchDoctorReport,
};
