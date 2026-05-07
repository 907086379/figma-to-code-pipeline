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
  assert.ok(manifest.ingestToolchain && manifest.ingestToolchain.packageVersion, "manifest.ingestToolchain.packageVersion");
  assert.strictEqual(manifest.ingestToolchain.script, "scripts/workflow/mcp-raw-ingest.cjs");

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

  // staging-ingest-* 输入目录在成功后应被删除（位于 cwd 下时）
  const cleanupBase = path.join(root, "tests", ".mcp-staging-cleanup");
  const stagingName = "staging-ingest-1-2";
  const stagingDir = path.join(cleanupBase, stagingName);
  fs.mkdirSync(stagingDir, { recursive: true });
  const stDc = path.join(stagingDir, "dc.txt");
  const stMeta = path.join(stagingDir, "meta.xml");
  const stVd = path.join(stagingDir, "vd.json");
  fs.writeFileSync(stDc, buildSmokeDesignContext(NODE_ID), "utf8");
  fs.writeFileSync(stMeta, `<symbol id="1:2" name="smoke" />\n`, "utf8");
  fs.writeFileSync(stVd, `${JSON.stringify({ "colors/smoke/test": "#112233" }, null, 2)}\n`, "utf8");

  const cleanupTemp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-mcp-staging-rm-"));
  const cleanupCache = path.join(cleanupTemp, "figma-cache");
  fs.mkdirSync(cleanupCache, { recursive: true });
  fs.writeFileSync(
    path.join(cleanupCache, "index.json"),
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

  try {
    assert.ok(fs.existsSync(stagingDir), "precondition: staging dir exists");
    execFileSync(
      process.execPath,
      [
        ingest,
        `--url=${TEST_URL}`,
        `--cache-dir=${cleanupCache}`,
        `--mcp-server=test-fake-mcp`,
        `--design-context-file=${stDc}`,
        `--metadata-file=${stMeta}`,
        `--variable-defs-file=${stVd}`,
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
          FIGMA_CACHE_DIR: cleanupCache,
        },
      },
    );
    assert.ok(!fs.existsSync(stagingDir), "staging-ingest-* input dir should be removed after success");
  } finally {
    fs.rmSync(cleanupTemp, { recursive: true, force: true });
    fs.rmSync(cleanupBase, { recursive: true, force: true });
  }

  // --stdin --materialize-staging：脚本自建 staging，成功后删除
  const matRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-mcp-materialize-"));
  const matCache = path.join(matRoot, "figma-cache");
  fs.mkdirSync(matCache, { recursive: true });
  fs.writeFileSync(
    path.join(matCache, "index.json"),
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
  const matStaging = path.join(matRoot, "staging-ingest-1-2");
  const matPayload = JSON.stringify({
    get_design_context: buildSmokeDesignContext(NODE_ID),
    get_metadata: `<symbol id="1:2" name="smoke" />\n`,
    get_variable_defs: { "colors/smoke/test": "#112233" },
  });
  try {
    execFileSync(
      process.execPath,
      [
        ingest,
        "--stdin",
        "--materialize-staging",
        `--url=${TEST_URL}`,
        `--cache-dir=${matCache}`,
        `--mcp-server=test-fake-mcp`,
        "--no-ensure",
        "--no-validate",
        "--skip-budget",
      ],
      {
        cwd: matRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        input: matPayload,
        env: {
          ...process.env,
          FIGMA_CACHE_DIR: matCache,
        },
      },
    );
    assert.ok(!fs.existsSync(matStaging), "materialize staging dir should be removed after success");
  } finally {
    fs.rmSync(matRoot, { recursive: true, force: true });
  }

  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-mcp-ingest-fail-"));
  const badCache = path.join(badRoot, "figma-cache");
  fs.mkdirSync(badCache, { recursive: true });
  let threw = false;
  try {
    execFileSync(
      process.execPath,
      [ingest, "--not-a-real-flag", `--cache-dir=${badCache}`, `--url=${TEST_URL}`],
      { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    threw = true;
  }
  assert.ok(threw, "unknown flag should fail");
  const failJson = path.join(badCache, "reports", "runtime", "mcp-ingest-failure.json");
  assert.ok(fs.existsSync(failJson), "preflight failure should write mcp-ingest-failure.json");
  const failBody = JSON.parse(fs.readFileSync(failJson, "utf8"));
  assert.strictEqual(failBody.failureKind, "preflight");
  assert.strictEqual(failBody.stage, "args");
  fs.rmSync(badRoot, { recursive: true, force: true });

  console.log("mcp-raw-ingest.test: ok");
}

run();
