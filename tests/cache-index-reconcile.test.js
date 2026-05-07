#!/usr/bin/env node
"use strict";

/**
 * cache-index-reconcile：磁盘有 mcp-raw、索引被掏空后，--apply 应能通过 ensure 恢复 index 项。
 */

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const ingest = path.join(root, "scripts", "workflow", "mcp-raw-ingest.cjs");
const reconcile = path.join(root, "scripts", "workflow", "cache-index-reconcile.cjs");

const FILE_KEY = "reconcileTest01AbCdEfGhIjKlMnOp";
const NODE_ID = "9:8";
const TEST_URL = `https://www.figma.com/file/${FILE_KEY}/x?node-id=9-8`;

function buildSmokeDesignContext(nodeId) {
  const nid = String(nodeId || "9:8");
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
      `        <img alt="" className="block max-w-none size-full" src=${
        i % 2 ? "imgSmokeB" : "imgSmokeA"
      }} />`,
    );
    lines.push(`      </div>`);
  }
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`}`);
  lines.push("");
  lines.push("// fixture padding to satisfy min-bytes checks");
  lines.push(`// ${"y".repeat(1200)}`);
  lines.push("");
  lines.push("SUPER CRITICAL: trailer should be stripped by ingest sanitizer.");
  return lines.join("\n");
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cache-reconcile-"));
  const cacheDir = path.join(tempRoot, "figma-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir, "index.json"),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        version: 1,
        normalizationVersion: 1,
        updatedAt: null,
        flows: {},
        items: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const dcPath = path.join(tempRoot, "dc.txt");
  const metaPath = path.join(tempRoot, "meta.xml");
  const vdPath = path.join(tempRoot, "vd.json");
  fs.writeFileSync(dcPath, buildSmokeDesignContext(NODE_ID), "utf8");
  fs.writeFileSync(metaPath, `<symbol id="9:8" name="smoke" />\n`, "utf8");
  fs.writeFileSync(vdPath, `${JSON.stringify({ "colors/smoke/test": "#112233" }, null, 2)}\n`, "utf8");

  execFileSync(
    process.execPath,
    [
      ingest,
      `--url=${TEST_URL}`,
      `--cache-dir=${cacheDir}`,
      `--mcp-server=test-reconcile-mcp`,
      `--design-context-file=${dcPath}`,
      `--metadata-file=${metaPath}`,
      `--variable-defs-file=${vdPath}`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FIGMA_CACHE_DIR: cacheDir,
      },
    },
  );

  const indexPath = path.join(cacheDir, "index.json");
  let idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const ck = `${FILE_KEY}#${NODE_ID}`;
  assert.ok(idx.items && idx.items[ck], "ingest should populate index");

  idx.items = {};
  fs.writeFileSync(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");

  execFileSync(process.execPath, [reconcile, `--cache-dir=${cacheDir}`, "--apply"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      FIGMA_CACHE_DIR: cacheDir,
    },
  });

  idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.ok(idx.items && idx.items[ck], "reconcile --apply should restore index item");

  idx.items = {};
  fs.writeFileSync(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");
  execFileSync(process.execPath, [reconcile, `--cache-dir=${cacheDir}`, "--dry-run", "--apply"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      FIGMA_CACHE_DIR: cacheDir,
    },
  });
  idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.ok(!idx.items[ck], "--dry-run must suppress --apply (index stays empty)");

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("cache-index-reconcile ok");
}

run();
