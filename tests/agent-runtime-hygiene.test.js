#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runAgentRuntimeHygieneGate } = require("../scripts/workflow/agent-runtime-hygiene-gate.cjs");

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-hygiene-"));
  const runtime = path.join(root, "figma-cache", "reports", "runtime");
  fs.mkdirSync(runtime, { recursive: true });

  let r = runAgentRuntimeHygieneGate(root);
  assert.strictEqual(r.ok, true);

  fs.writeFileSync(path.join(runtime, "ingest-one.cjs"), "// glue\n", "utf8");
  r = runAgentRuntimeHygieneGate(root);
  assert.strictEqual(r.ok, false);
  assert.ok(r.blocking.some((b) => b.includes("ingest-one.cjs")));

  fs.unlinkSync(path.join(runtime, "ingest-one.cjs"));
  const staging = path.join(runtime, "staging-1-2");
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, "x.txt"), "x", "utf8");
  r = runAgentRuntimeHygieneGate(root);
  assert.strictEqual(r.ok, false);

  fs.writeFileSync(path.join(staging, ".fc-mcp-ingest-staging"), "1\n", "utf8");
  r = runAgentRuntimeHygieneGate(root);
  assert.strictEqual(r.ok, true);

  const rootStaging = path.join(root, "staging-ingest-agent-leftover");
  fs.mkdirSync(rootStaging);
  fs.writeFileSync(path.join(rootStaging, "chunk.txt"), "x", "utf8");
  r = runAgentRuntimeHygieneGate(root);
  assert.strictEqual(r.ok, false);
  assert.ok(r.blocking.some((b) => b.includes("project-root staging")));

  fs.writeFileSync(path.join(rootStaging, ".fc-mcp-ingest-staging"), "1\n", "utf8");
  r = runAgentRuntimeHygieneGate(root);
  assert.strictEqual(r.ok, true);

  console.log("agent-runtime-hygiene.test.js: ok");
}

run();
