#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { writeMcpIngestFailureArtifact } = require("../scripts/workflow/mcp-ingest-failure-artifact.cjs");

function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-fail-art-"));
  const cacheDir = path.join(tmp, "figma-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const rel = writeMcpIngestFailureArtifact({
    cacheDirAbs: cacheDir,
    cacheKeyStr: "abc#1:2",
    stage: "ensure",
    exitCode: 2,
    commandLine: "node bin/figma-cache.js ensure ...",
    stdout: "out",
    stderr: "err-detail",
    cwdForRelative: tmp,
  });

  assert.ok(rel.jsonPath, "jsonPath");
  assert.ok(rel.logPath, "logPath");
  const absJson = path.join(tmp, rel.jsonPath);
  const absLog = path.join(tmp, rel.logPath);
  assert.ok(fs.existsSync(absJson), "failure json exists");
  assert.ok(fs.existsSync(absLog), "failure log exists");
  const payload = JSON.parse(fs.readFileSync(absJson, "utf8"));
  assert.strictEqual(payload.failureKind, "gate");
  assert.strictEqual(payload.stage, "ensure");
  assert.strictEqual(payload.exitCode, 2);
  assert.strictEqual(payload.cacheKey, "abc#1:2");
  assert.ok(String(fs.readFileSync(absLog, "utf8")).includes("err-detail"));

  const pre = writeMcpIngestFailureArtifact({
    cacheDirAbs: cacheDir,
    cacheKeyStr: "x#1:1",
    stage: "args",
    exitCode: 1,
    commandLine: "node scripts/workflow/mcp-raw-ingest.cjs",
    stdout: "",
    stderr: "bad argv",
    cwdForRelative: tmp,
    failureKind: "preflight",
  });
  const prePayload = JSON.parse(fs.readFileSync(path.join(tmp, pre.jsonPath), "utf8"));
  assert.strictEqual(prePayload.failureKind, "preflight");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("mcp-ingest-failure-artifact ok");
}

run();
