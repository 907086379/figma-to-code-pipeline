#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const ingest = path.join(root, "scripts", "workflow", "mcp-raw-ingest.cjs");

const FILE_KEY = "stagingDirKey01";
const NODE_ID = "77:88";
const TEST_URL = `https://www.figma.com/design/${FILE_KEY}/x?node-id=77-88`;

function buildDc() {
  return `export function Smoke() { return <div data-node-id="${NODE_ID}" />; }\n// ${"q".repeat(900)}\n`;
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-staging-dir-"));
  const cacheDir = path.join(tempRoot, "figma-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir, "index.json"),
    `${JSON.stringify(
      { schemaVersion: 2, version: 1, normalizationVersion: 1, updatedAt: null, flows: {}, items: {} },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const stdStaging = path.join(tempRoot, "staging-ingest-77-88");
  fs.mkdirSync(stdStaging, { recursive: true });
  fs.writeFileSync(path.join(stdStaging, ".fc-mcp-ingest-staging"), "1\n", "utf8");
  fs.writeFileSync(path.join(stdStaging, "mcp-raw-get-design-context.txt"), buildDc(), "utf8");
  fs.writeFileSync(path.join(stdStaging, "mcp-raw-get-metadata.xml"), `<symbol id="${NODE_ID}" />\n`, "utf8");
  fs.writeFileSync(path.join(stdStaging, "mcp-raw-get-variable-defs.json"), "{}\n", "utf8");

  execFileSync(
    process.execPath,
    [
      ingest,
      `--url=${TEST_URL}`,
      `--cache-dir=${cacheDir}`,
      `--staging-dir=${stdStaging}`,
      "--no-ensure",
      "--no-validate",
      "--skip-budget",
    ],
    { cwd: tempRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  assert.ok(!fs.existsSync(stdStaging), "standard-name staging dir should be removed");

  const convStaging = path.join(tempRoot, "staging-ingest-conv");
  fs.mkdirSync(convStaging, { recursive: true });
  fs.writeFileSync(path.join(convStaging, ".fc-mcp-ingest-staging"), "1\n", "utf8");
  fs.writeFileSync(path.join(convStaging, "77-88-dc.txt"), buildDc(), "utf8");
  fs.writeFileSync(path.join(convStaging, "77-88-meta.txt"), `<symbol id="${NODE_ID}" />\n`, "utf8");
  fs.writeFileSync(path.join(convStaging, "77-88-vd.json"), "{}\n", "utf8");

  execFileSync(
    process.execPath,
    [
      ingest,
      `--url=${TEST_URL}`,
      `--cache-dir=${cacheDir}`,
      `--staging-dir=${convStaging}`,
      "--no-ensure",
      "--no-validate",
      "--skip-budget",
    ],
    { cwd: tempRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  assert.ok(!fs.existsSync(convStaging), "convention-name staging dir should be removed");

  const manifest = path.join(cacheDir, "files", FILE_KEY, "nodes", "77-88", "mcp-raw", "mcp-raw-manifest.json");
  assert.ok(fs.existsSync(manifest), "manifest should exist after staging-dir ingest");

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("mcp-raw-ingest-staging-dir.test.js: ok");
}

run();
