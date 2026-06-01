#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

/** npm 包根（本脚本所在包） */
const PACKAGE_ROOT = path.join(__dirname, "..", "..");
const BOOTSTRAP = path.join(PACKAGE_ROOT, "cursor-bootstrap");
const MANAGED_FILES_PATH = path.join(BOOTSTRAP, "managed-files.json");
/** 消费方业务仓根（须在项目根执行本脚本） */
const PROJECT_ROOT = process.cwd();
const {
  isSetupComplete,
  effectiveRetiredFiles,
  shouldSkipStackAdapterMirror,
} = require("./cursor-shadow-setup.cjs");

function normalize(relPath) {
  return relPath.replace(/\\/g, "/");
}

function loadManifest() {
  if (!fs.existsSync(MANAGED_FILES_PATH)) {
    throw new Error(`Missing managed files manifest: ${MANAGED_FILES_PATH}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(MANAGED_FILES_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in managed files manifest: ${error.message}`);
  }

  const { managedFiles, retiredFiles } = parsed || {};
  if (!Array.isArray(managedFiles) || managedFiles.length === 0) {
    throw new Error("managed-files.json must contain a non-empty managedFiles array");
  }

  const pairs = managedFiles.map((item, index) => {
    if (!item || typeof item.from !== "string" || typeof item.to !== "string") {
      throw new Error(`Invalid managedFiles[${index}] entry; expected { from, to } strings`);
    }
    return [item.from, item.to];
  });

  const retired = Array.isArray(retiredFiles)
    ? retiredFiles.filter((item) => typeof item === "string" && item.trim())
    : [];

  return { pairs, retired };
}

function copyPair(relFrom, relTo) {
  const src = path.join(BOOTSTRAP, relFrom);
  const dst = path.join(PROJECT_ROOT, relTo);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source template: ${src}`);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return {
    from: normalize(`cursor-bootstrap/${relFrom}`),
    to: normalize(relTo),
  };
}

function deleteRetired(relPath) {
  const abs = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return null;
  }
  fs.unlinkSync(abs);
  return normalize(relPath);
}

function main() {
  if (!fs.existsSync(BOOTSTRAP)) {
    throw new Error(`Missing cursor-bootstrap directory: ${BOOTSTRAP}`);
  }

  const setupComplete = isSetupComplete(PROJECT_ROOT);

  const { pairs, retired } = loadManifest();
  const effectiveRetired = effectiveRetiredFiles(retired, setupComplete);

  const copied = [];
  for (const [from, to] of pairs) {
    if (shouldSkipStackAdapterMirror(to, setupComplete)) {
      continue;
    }
    copied.push(copyPair(from, to));
  }

  const retiredDeleted = effectiveRetired
    .map((relPath) => deleteRetired(relPath))
    .filter(Boolean);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        projectRoot: normalize(PROJECT_ROOT),
        packageRoot: normalize(PACKAGE_ROOT),
        setupComplete: Boolean(setupComplete),
        sourceOfTruth: "cursor-bootstrap/managed-files.json",
        copied,
        retiredDeleted,
      },
      null,
      2,
    )}\n`,
  );
}

main();
