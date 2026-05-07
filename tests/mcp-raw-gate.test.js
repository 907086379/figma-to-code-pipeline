#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const gate = path.join(root, "scripts", "workflow", "mcp-raw-gate.cjs");

function run() {
  const out = execFileSync(process.execPath, [gate], {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  const lines = out.trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1];
  let summary;
  try {
    summary = JSON.parse(last);
  } catch {
    throw new Error(`expected last stdout line to be gate summary JSON, got: ${last.slice(0, 120)}`);
  }
  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.fcMcpGate, true);
  assert.ok(Array.isArray(summary.steps));
  assert.ok(summary.steps.includes("validate:ok"));
  assert.ok(summary.steps.includes("budget:ok"));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-mcp-gate-"));
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

  execFileSync(process.execPath, [gate, "--skip-budget"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FIGMA_CACHE_DIR: cacheDir },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let threw = false;
  try {
    execFileSync(process.execPath, [gate, "--unknown-flag"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, "unknown flag should fail");

  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log("mcp-raw-gate.test: ok");
}

run();
