#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const {
  normalizeMountMode,
  normalizeProfile,
  resolveUiBatchProfile,
  collectTargetDeprecationWarnings,
  isTargetRootUnderPages,
  isLegacyTargetRoot,
  detectMountPage,
  resolveMountStrategy,
  resolveBatchTargetEntry,
  buildUiBatchDoctorReport,
  STRICT_BLOCKING_FINDINGS,
  DEFAULT_UI_BATCH_ROOT,
} = require("../scripts/ui/ui-batch-mount.cjs");

function run() {
  assert.strictEqual(normalizeMountMode(""), "manual");
  assert.strictEqual(normalizeMountMode("OFF"), "off");
  assert.strictEqual(normalizeMountMode("skip"), "manual");
  assert.strictEqual(normalizeMountMode("auto"), "auto");
  assert.strictEqual(normalizeMountMode("not-a-mode"), "manual");

  assert.strictEqual(normalizeProfile("", "react"), "react");
  assert.strictEqual(normalizeProfile("", "html"), "html");
  assert.strictEqual(normalizeProfile("", "vue"), "vue3-vite-auto-routes-tailwind");

  const known = resolveUiBatchProfile(null, "vue3-vite-auto-routes-tailwind", "vue");
  assert.strictEqual(known.fallback, false);
  assert.strictEqual(known.name, "vue3-vite-auto-routes-tailwind");
  assert.strictEqual(known.preset.targetRoot, DEFAULT_UI_BATCH_ROOT);

  const unknown = resolveUiBatchProfile(null, "not-a-real-profile", "vue");
  assert.strictEqual(unknown.fallback, true);
  assert.strictEqual(unknown.fallbackTo, "vue3-vite-auto-routes-tailwind");
  assert.strictEqual(unknown.preset.targetRoot, DEFAULT_UI_BATCH_ROOT);

  assert.strictEqual(isTargetRootUnderPages("./src/pages/foo"), true);
  assert.strictEqual(isTargetRootUnderPages("./src/components/figma-batch"), false);
  assert.strictEqual(isLegacyTargetRoot("./src/pages/main/components"), true);

  const deprecate = collectTargetDeprecationWarnings({
    targetRoot: "./src/pages/main/components",
    targetEntry: "./src/pages/main/components/Foo/index.vue",
    explicitTarget: false,
  });
  assert.ok(deprecate.length >= 1);
  assert.ok(deprecate.some((line) => line.includes("deprecate")));

  const tmpRoot = path.join(__dirname, ".tmp-ui-batch-mount");
  const mount = detectMountPage(
    tmpRoot,
    {},
    {
      mountPageCandidates: ["./src/pages/figma-preview.vue", "./src/pages/index.vue"],
    },
    "vue"
  );
  assert.strictEqual(mount.from, "profile-fallback");
  assert.strictEqual(mount.mountPage, "./src/pages/figma-preview.vue");

  const manualMount = resolveMountStrategy(tmpRoot, {}, known.preset, "vue", "manual");
  assert.strictEqual(manualMount.enabled, false);
  assert.strictEqual(manualMount.mountMode, "manual");

  const autoMount = resolveMountStrategy(tmpRoot, { mountPage: "./src/pages/figma-preview.vue" }, known.preset, "vue", "auto");
  assert.strictEqual(autoMount.enabled, true);
  assert.strictEqual(autoMount.mountPage, "./src/pages/figma-preview.vue");

  const preserved = resolveBatchTargetEntry({
    existingCase: { target: { entry: "./src/custom/KeepMe/index.vue" } },
    explicitTarget: false,
    explicitTargetRoot: false,
    explicitTargetValue: "",
    resolvedFromTemplate: {
      entry: "./src/components/figma-batch/FigmaNode1x2/index.vue",
      targetRoot: "./src/components/figma-batch",
    },
  });
  assert.strictEqual(preserved.source, "preserve-existing");
  assert.strictEqual(preserved.entry, "./src/custom/KeepMe/index.vue");

  const migratedRoot = resolveBatchTargetEntry({
    existingCase: { target: { entry: "./src/custom/KeepMe/index.vue" } },
    explicitTarget: false,
    explicitTargetRoot: true,
    explicitTargetValue: "",
    resolvedFromTemplate: {
      entry: "./src/ui/components/FigmaNode1x2/index.vue",
      targetRoot: "./src/ui/components",
    },
  });
  assert.strictEqual(migratedRoot.source, "explicit-migrate");
  assert.strictEqual(migratedRoot.entry, "./src/ui/components/FigmaNode1x2/index.vue");

  const migratedTarget = resolveBatchTargetEntry({
    existingCase: { target: { entry: "./src/custom/KeepMe/index.vue" } },
    explicitTarget: true,
    explicitTargetRoot: false,
    explicitTargetValue: "./src/explicit/Override.vue",
    resolvedFromTemplate: { entry: "./ignored/index.vue", targetRoot: "./ignored" },
  });
  assert.strictEqual(migratedTarget.source, "explicit-migrate");
  assert.strictEqual(migratedTarget.entry, "./src/explicit/Override.vue");

  const doctorNoConfig = buildUiBatchDoctorReport(tmpRoot, {
    config: {},
    uiBatchExists: false,
    framework: "vue",
    routeMode: "vue-router-auto-routes",
  });
  assert.ok(doctorNoConfig.advisories.includes("missing-ui-batch-config"));
  assert.strictEqual(doctorNoConfig.ok, true);
  assert.strictEqual(doctorNoConfig.fullyOk, false);

  const doctorBadRoot = buildUiBatchDoctorReport(tmpRoot, {
    config: { targetRoot: "./src/pages/foo", profile: "vue3-vite-auto-routes-tailwind" },
    uiBatchExists: true,
    framework: "vue",
    routeMode: "vue-router-auto-routes",
  });
  assert.ok(doctorBadRoot.findings.includes("target-root-in-pages"));
  assert.ok(doctorBadRoot.findings.includes("auto-routes-risk"));
  assert.strictEqual(doctorBadRoot.ok, false);
  assert.ok(doctorBadRoot.blockingFindings.every((f) => STRICT_BLOCKING_FINDINGS.has(f)));

  console.log("ui-batch-mount.test: ok");
}

run();
