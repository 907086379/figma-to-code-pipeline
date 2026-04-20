#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BOOTSTRAP = path.join(ROOT, "cursor-bootstrap");
const MANAGED_FILES_PATH = path.join(BOOTSTRAP, "managed-files.json");

function readUtf8(absPath) {
  return fs.readFileSync(absPath, "utf8");
}

function normalize(relPath) {
  return relPath.replace(/\\/g, "/");
}

function loadManifest() {
  if (!fs.existsSync(MANAGED_FILES_PATH)) {
    throw new Error(`Missing managed files manifest: ${MANAGED_FILES_PATH}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readUtf8(MANAGED_FILES_PATH));
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

function main() {
  const errors = [];
  const checked = [];
  const { pairs, retired } = loadManifest();

  for (const [from, to] of pairs) {
    const src = path.join(BOOTSTRAP, from);
    const dst = path.join(ROOT, to);
    const fromNorm = normalize(`cursor-bootstrap/${from}`);
    const toNorm = normalize(to);

    if (!fs.existsSync(src)) {
      errors.push(`missing source: ${fromNorm}`);
      continue;
    }
    if (!fs.existsSync(dst)) {
      errors.push(`missing mirror: ${toNorm}`);
      continue;
    }

    const srcText = readUtf8(src);
    const dstText = readUtf8(dst);
    if (srcText !== dstText) {
      errors.push(`drift detected: ${fromNorm} != ${toNorm}`);
      continue;
    }

    checked.push({ from: fromNorm, to: toNorm });
  }

  const retiredExisting = retired
    .filter((relPath) => fs.existsSync(path.join(ROOT, relPath)))
    .map((relPath) => normalize(relPath));
  if (retiredExisting.length) {
    errors.push(`retired mirror files still exist: ${retiredExisting.join(", ")}`);
  }

  if (errors.length) {
    process.stderr.write(
      `[verify:cursor] failed\n- ${errors.join("\n- ")}\nRun: npm run verify:cursor:sync\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        sourceOfTruth: "cursor-bootstrap/managed-files.json",
        checked,
      },
      null,
      2
    )}\n`
  );
}

main();