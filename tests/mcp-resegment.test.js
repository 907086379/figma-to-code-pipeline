#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const resegmentCli = path.join(root, "scripts", "workflow", "mcp-resegment.cjs");
const ingestCli = path.join(root, "scripts", "workflow", "mcp-raw-ingest.cjs");

const FILE_KEY = "resegTestKey01";
const NODE_ID = "55:66";
const TEST_URL = `https://www.figma.com/design/${FILE_KEY}/x?node-id=55-66`;

function buildSmokeDesignContext(nodeId) {
  const nid = String(nodeId || NODE_ID);
  const lines = [];
  lines.push(
    `const imgSmokeA = "https://www.figma.com/api/mcp/asset/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";`,
  );
  lines.push(
    `const imgSmokeB = "https://www.figma.com/api/mcp/asset/bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";`,
  );
  lines.push(`export function SmokeFrame() {`);
  lines.push(`  return (`);
  lines.push(
    `    <div className="bg-[#111111] flex flex-col gap-2 p-4" data-node-id="${nid}" data-name="smoke-root">`,
  );
  for (let i = 0; i < 12; i += 1) {
    lines.push(`      <div data-node-id="98:${100 + i}" className="content-stretch flex size-[24px]">`);
    lines.push(
      `        <img alt="" className="block max-w-none size-full" src=${i % 2 ? "imgSmokeB" : "imgSmokeA"}} />`,
    );
    lines.push(`      </div>`);
  }
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`}`);
  lines.push(`// ${"y".repeat(1200)}`);
  return lines.join("\n");
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-resegment-"));
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

  const dc = path.join(tempRoot, "dc.txt");
  const meta = path.join(tempRoot, "meta.xml");
  const vd = path.join(tempRoot, "vd.json");
  fs.writeFileSync(dc, buildSmokeDesignContext(NODE_ID), "utf8");
  fs.writeFileSync(meta, `<symbol id="${NODE_ID}" name="smoke" />\n`, "utf8");
  fs.writeFileSync(vd, `${JSON.stringify({ "colors/smoke/test": "#112233" }, null, 2)}\n`, "utf8");

  execFileSync(
    process.execPath,
    [
      ingestCli,
      `--url=${TEST_URL}`,
      `--cache-dir=${cacheDir}`,
      `--design-context-file=${dc}`,
      `--metadata-file=${meta}`,
      `--variable-defs-file=${vd}`,
      "--skip-budget",
    ],
    { cwd: tempRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  const flatManifest = path.join(
    cacheDir,
    "files",
    FILE_KEY,
    "nodes",
    "55-66",
    "mcp-raw",
    "mcp-raw-manifest.json",
  );
  assert.ok(fs.existsSync(flatManifest), "flat mcp-raw should exist after ingest");

  execFileSync(
    process.execPath,
    [
      resegmentCli,
      `--file-key=${FILE_KEY}`,
      `--node-id=${NODE_ID}`,
      `--node-segment=sip`,
      `--cache-dir=${cacheDir}`,
      "--quiet",
    ],
    { cwd: tempRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  const targetManifest = path.join(
    cacheDir,
    "files",
    FILE_KEY,
    "nodes",
    "sip",
    "55-66",
    "mcp-raw",
    "mcp-raw-manifest.json",
  );
  assert.ok(fs.existsSync(targetManifest), "target segment mcp-raw should exist");
  const body = JSON.parse(fs.readFileSync(targetManifest, "utf8"));
  assert.strictEqual(body.ingestToolchain.script, "scripts/workflow/mcp-resegment.cjs");
  assert.ok(body.ingestToolchain.resegmentedFrom);

  execFileSync(
    process.execPath,
    [
      resegmentCli,
      `--file-key=${FILE_KEY}`,
      `--node-id=${NODE_ID}`,
      `--node-segment=sip`,
      `--source-node-segment=sip`,
      `--cache-dir=${cacheDir}`,
      "--quiet",
    ],
    { cwd: tempRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  const flatNodeDir = path.join(cacheDir, "files", FILE_KEY, "nodes", "55-66");
  assert.ok(fs.existsSync(flatNodeDir), "flat source dir should remain without --remove-source");

  execFileSync(
    process.execPath,
    [
      resegmentCli,
      `--file-key=${FILE_KEY}`,
      `--node-id=${NODE_ID}`,
      `--node-segment=other`,
      `--source-node-segment=sip`,
      `--cache-dir=${cacheDir}`,
      "--force",
      "--remove-source",
      "--quiet",
    ],
    { cwd: tempRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  const sipNodeDir = path.join(cacheDir, "files", FILE_KEY, "nodes", "sip", "55-66");
  assert.ok(!fs.existsSync(sipNodeDir), "source segment dir should be removed with --remove-source");
  const otherManifest = path.join(
    cacheDir,
    "files",
    FILE_KEY,
    "nodes",
    "other",
    "55-66",
    "mcp-raw",
    "mcp-raw-manifest.json",
  );
  assert.ok(fs.existsSync(otherManifest), "target segment mcp-raw should remain");

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("mcp-resegment.test.js: ok");
}

run();
