#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const BATCH_ADD = path.join(REPO_ROOT, "scripts", "batch-add.cjs");
const FILE_KEY = "TestFileKeyBatchAdd";
const NODE_ID = "9001-9002";

function runBatchAdd(cwd, batchRel, extraArgs) {
  const batchAbs = path.join(cwd, batchRel);
  const args = [
    BATCH_ADD,
    NODE_ID,
    `--fileKey=${FILE_KEY}`,
    `--batch=${batchAbs}`,
    "--kind=vue",
    "--no-relations-report",
    "--no-suggestions-report",
    ...(extraArgs || []),
  ];
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `batch-add failed (exit ${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return { stdout: result.stdout, batchAbs };
}

function readBatch(batchAbs) {
  return JSON.parse(fs.readFileSync(batchAbs, "utf8"));
}

function findCase(batch) {
  return (batch.cases || []).find(
    (c) =>
      c &&
      c.designRef &&
      c.designRef.fileKey === FILE_KEY &&
      c.designRef.nodeId === NODE_ID
  );
}

function run() {
  const tmpRoot = path.join(__dirname, ".tmp-batch-add-target-entry");
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  try {
    const batchRel = "figma-e2e-batch.json";
    const customEntry = "./src/legacy/CustomPanel/index.vue";

    fs.writeFileSync(
      path.join(tmpRoot, batchRel),
      `${JSON.stringify(
        {
          version: 2,
          cases: [
            {
              id: `vue-${FILE_KEY}-${NODE_ID}`,
              designRef: { fileKey: FILE_KEY, nodeId: NODE_ID },
              target: { kind: "vue", entry: customEntry, assets: [] },
              audit: { mode: "web-strict" },
            },
          ],
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const first = runBatchAdd(tmpRoot, batchRel, []);
    assert.ok(first.stdout.includes("preserve-existing"), first.stdout);
    let batch = readBatch(first.batchAbs);
    assert.strictEqual(findCase(batch).target.entry, customEntry);

    const second = runBatchAdd(tmpRoot, batchRel, ["--target-root=./src/ui/components"]);
    assert.ok(second.stdout.includes("explicit-migrate"), second.stdout);
    batch = readBatch(second.batchAbs);
    const migrated = findCase(batch).target.entry;
    assert.notStrictEqual(migrated, customEntry);
    assert.ok(migrated.includes("/src/ui/components/"), migrated);

    console.log("batch-add-target-entry.integration.test: ok");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run();
