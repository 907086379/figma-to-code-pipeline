#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const manifestCli = path.join(root, "scripts", "workflow", "mcp-cache-manifest.cjs");

const FILE_KEY = "manifestTestKey01";
const NODE_ID = "99:88";
const TEST_URL = `https://www.figma.com/design/${FILE_KEY}/x?node-id=99-88`;

function writeIndex(cacheDir) {
  fs.writeFileSync(
    path.join(cacheDir, "index.json"),
    `${JSON.stringify(
      { schemaVersion: 2, version: 1, normalizationVersion: 1, updatedAt: null, flows: {}, items: {} },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function seedMcpRaw(cacheDir, segment) {
  const nodeDir = path.join(cacheDir, "files", FILE_KEY, "nodes", segment, "99-88", "mcp-raw");
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(nodeDir, "mcp-raw-manifest.json"),
    `${JSON.stringify({ fileKey: FILE_KEY, nodeId: NODE_ID, files: {}, fileHashes: {}, fileSizes: {}, toolCalls: {} }, null, 2)}\n`,
    "utf8",
  );
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-manifest-"));
  const cacheDir = path.join(tempRoot, "figma-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  writeIndex(cacheDir);

  const gapManifest = path.join(tempRoot, "gap.json");
  fs.writeFileSync(
    gapManifest,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultNodeSegment: "sip",
        items: [{ url: TEST_URL, label: "overview" }],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  let threw = false;
  try {
    execFileSync(process.execPath, [manifestCli, `--manifest=${gapManifest}`, `--cache-dir=${cacheDir}`], {
      cwd: tempRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, "gap-check should fail when mcp-raw missing");

  seedMcpRaw(cacheDir, "sip");
  execFileSync(process.execPath, [manifestCli, `--manifest=${gapManifest}`, `--cache-dir=${cacheDir}`], {
    cwd: tempRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  const flatManifest = path.join(tempRoot, "flat.json");
  fs.writeFileSync(
    flatManifest,
    `${JSON.stringify([{ url: TEST_URL, nodeSegment: "sip" }], null, 2)}\n`,
    "utf8",
  );
  execFileSync(process.execPath, [manifestCli, `--manifest=${flatManifest}`, `--cache-dir=${cacheDir}`], {
    cwd: tempRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  const ingestManifest = path.join(tempRoot, "ingest.json");
  const otherUrl = `https://www.figma.com/design/${FILE_KEY}/x?node-id=10-20`;
  fs.writeFileSync(
    ingestManifest,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        items: [
          { url: otherUrl, get_design_context: "dc", get_metadata: "<x/>", get_variable_defs: {} },
          { url: TEST_URL, nodeSegment: "sip" },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  threw = false;
  try {
    execFileSync(
      process.execPath,
      [
        manifestCli,
        `--manifest=${ingestManifest}`,
        `--cache-dir=${cacheDir}`,
        "--ingest",
        "--no-validate",
        "--skip-existing",
      ],
      { cwd: tempRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    threw = true;
  }
  assert.ok(threw, "ingest should fail when item lacks MCP payload");

  threw = false;
  try {
    execFileSync(
      process.execPath,
      [manifestCli, `--manifest=${gapManifest}`, "--ingest", "--gap-check-only"],
      { cwd: tempRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    threw = true;
  }
  assert.ok(threw, "--ingest with --gap-check-only should fail");

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("mcp-cache-manifest.test.js: ok");
}

run();
