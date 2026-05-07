#!/usr/bin/env node
"use strict";

/**
 * Exercises scripts/workflow/mcp-raw-ingest.cjs against an isolated FIGMA_CACHE_DIR.
 */

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const ingest = path.join(root, "scripts", "workflow", "mcp-raw-ingest.cjs");

const FILE_KEY = "abcABCd0123456789vWxyZ";
const NODE_ID = "1:2";
const TEST_URL = `https://www.figma.com/file/${FILE_KEY}/x?node-id=1-2`;

function buildSmokeDesignContext(nodeId) {
  const nid = String(nodeId || "1:2");
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-mcp-ingest-"));
  const cacheDir = path.join(tempRoot, "figma-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const indexPath = path.join(cacheDir, "index.json");
  fs.writeFileSync(
    indexPath,
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
  fs.writeFileSync(metaPath, `<symbol id="1:2" name="smoke" />\n`, "utf8");
  fs.writeFileSync(vdPath, `${JSON.stringify({ "colors/smoke/test": "#112233" }, null, 2)}\n`, "utf8");

  execFileSync(
    process.execPath,
    [
      ingest,
      `--url=${TEST_URL}`,
      `--cache-dir=${cacheDir}`,
      `--mcp-server=test-fake-mcp`,
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

  const manifestPath = path.join(
    cacheDir,
    "files",
    FILE_KEY,
    "nodes",
    "1-2",
    "mcp-raw",
    "mcp-raw-manifest.json",
  );
  assert.ok(fs.existsSync(manifestPath), "manifest should exist");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.strictEqual(manifest.mcpServer, "test-fake-mcp");
  assert.ok(manifest.fileHashes.get_design_context);

  const dcCached = fs.readFileSync(
    path.join(path.dirname(manifestPath), "mcp-raw-get-design-context.txt"),
    "utf8",
  );
  assert.ok(!/SUPER CRITICAL/i.test(dcCached), "design context should be sanitized by default");

  fs.rmSync(tempRoot, { recursive: true, force: true });

  const quietRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-mcp-ingest-quiet-"));
  const quietCache = path.join(quietRoot, "figma-cache");
  fs.mkdirSync(quietCache, { recursive: true });
  fs.writeFileSync(
    path.join(quietCache, "index.json"),
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
  const quietDc = path.join(quietRoot, "dcq.txt");
  const quietMeta = path.join(quietRoot, "metaq.xml");
  const quietVd = path.join(quietRoot, "vdq.json");
  fs.writeFileSync(quietDc, buildSmokeDesignContext(NODE_ID), "utf8");
  fs.writeFileSync(quietMeta, `<symbol id="1:2" name="smoke" />\n`, "utf8");
  fs.writeFileSync(quietVd, `${JSON.stringify({ "colors/smoke/test": "#112233" }, null, 2)}\n`, "utf8");

  const quietOut = execFileSync(
    process.execPath,
    [
      ingest,
      `--url=${TEST_URL}`,
      `--cache-dir=${quietCache}`,
      `--mcp-server=test-fake-mcp`,
      `--design-context-file=${quietDc}`,
      `--metadata-file=${quietMeta}`,
      `--variable-defs-file=${quietVd}`,
      "--quiet",
      "--no-ensure",
      "--no-validate",
      "--skip-budget",
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FIGMA_CACHE_DIR: quietCache,
      },
    },
  );
  const quietLines = String(quietOut).trim().split(/\r?\n/).filter(Boolean);
  assert.strictEqual(quietLines.length, 1, "quiet mode should print one summary line");
  assert.ok(/^fc:mcp:ingest ok /.test(quietLines[0]), quietLines[0]);

  fs.rmSync(quietRoot, { recursive: true, force: true });

  console.log("mcp-raw-ingest.test: ok");
}

run();
