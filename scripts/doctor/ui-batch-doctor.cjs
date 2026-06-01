#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseCli } = require("../cli-args.cjs");
const { readUiBatchConfig, buildUiBatchDoctorReport } = require("../ui/ui-batch-mount.cjs");

const ROOT = process.cwd();
const FAIL_EXIT_CODE = 2;

function readJsonIfExists(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function readTextIfExists(absPath) {
  if (!fs.existsSync(absPath)) return "";
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

function detectRouteMode() {
  const viteCandidates = ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"];
  const viteText = viteCandidates.map((x) => readTextIfExists(path.join(ROOT, x))).join("\n");
  if (/vue-router\/vite/.test(viteText) || /auto-routes/.test(viteText)) {
    return "vue-router-auto-routes";
  }
  if (/createRouter|vue-router/.test(viteText)) {
    return "vue-router";
  }
  return "unknown";
}

function detectFramework(pkg) {
  const deps = Object.assign(
    {},
    pkg && pkg.dependencies ? pkg.dependencies : {},
    pkg && pkg.devDependencies ? pkg.devDependencies : {}
  );
  if (deps.vue) return "vue";
  if (deps.react) return "react";
  return "unknown";
}

function main() {
  const { values, flags } = parseCli(process.argv, {
    strings: ["out", "profile", "kind"],
    booleanFlags: ["json", "strict"],
  });
  const pkg = readJsonIfExists(path.join(ROOT, "package.json")) || {};
  const uiBatch = readUiBatchConfig(ROOT);
  const config = uiBatch.config || {};

  const framework = detectFramework(pkg);
  const routeMode = detectRouteMode();
  const doctor = buildUiBatchDoctorReport(ROOT, {
    config,
    uiBatchExists: uiBatch.exists,
    framework,
    routeMode,
    profile: String(values.profile || "").trim(),
    kind: String(values.kind || "").trim() || "vue",
  });

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectRoot: ROOT,
    framework,
    routeMode,
    uiBatch: {
      configPath: uiBatch.path,
      exists: uiBatch.exists,
      profile: doctor.profile,
      profileRequested: doctor.profileWrap.name,
      profileFallback: doctor.profileWrap.fallback,
      targetRoot: doctor.targetRoot,
      targetTemplate: doctor.targetTemplate,
      mountMode: doctor.mountMode,
      mountPage: doctor.mountPage || null,
      mountDetectFrom: doctor.mountDetectFrom || null,
      mountPageExists: doctor.mountPageExists,
    },
    advisories: doctor.advisories,
    findings: doctor.findings,
    blockingFindings: doctor.blockingFindings,
    recommendations: doctor.recommendations,
    ok: doctor.ok,
    fullyOk: doctor.fullyOk,
  };

  const outPath = String(values.out || "").trim();
  if (outPath) {
    const outAbs = path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  const asJson = !!flags.json;
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("[fc:doctor] ui-batch compatibility report");
    console.log(`- framework: ${framework}`);
    console.log(`- routeMode: ${routeMode}`);
    console.log(`- profile: ${doctor.profile}${doctor.profileWrap.fallback ? ` (fallback from "${doctor.profileWrap.name}")` : ""}`);
    console.log(`- targetRoot: ${doctor.targetRoot}`);
    console.log(`- mountMode: ${doctor.mountMode}`);
    if (doctor.mountMode === "auto") {
      console.log(
        `- mountPage: ${doctor.mountPage} (${doctor.mountPageExists ? "exists" : "missing"}, source=${doctor.mountDetectFrom})`
      );
    } else {
      console.log("- mountPage: <not required>");
    }
    console.log(`- advisories: ${doctor.advisories.length ? doctor.advisories.join(", ") : "none"}`);
    console.log(`- findings: ${doctor.findings.length ? doctor.findings.join(", ") : "none"}`);
    if (doctor.recommendations.length) {
      console.log(`- recommendations: ${doctor.recommendations.join(", ")}`);
    }
    console.log(`- ok (strict/blocking): ${doctor.ok}`);
    console.log(`- fullyOk: ${doctor.fullyOk}`);
  }

  if (flags.strict && !doctor.ok) {
    process.exit(FAIL_EXIT_CODE);
  }
}

main();
