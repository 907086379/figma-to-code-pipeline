#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const batchSrc = fs.readFileSync(path.join(root, "scripts", "workflow", "mcp-cache-batch.cjs"), "utf8");

function run() {
  assert.ok(
    batchSrc.includes("const PKG_ROOT = path.resolve(__dirname"),
    "mcp-cache-batch must define PKG_ROOT",
  );
  assert.ok(
    batchSrc.includes('const BIN = path.join(PKG_ROOT, "bin", "figma-cache.js")'),
    "mcp-cache-batch BIN must use PKG_ROOT (not process.cwd())",
  );
  assert.ok(
    !batchSrc.includes('const BIN = path.join(ROOT, "bin", "figma-cache.js")'),
    "mcp-cache-batch must not bind BIN to consumer cwd ROOT",
  );

  console.log("mcp-cache-batch.test.js: ok");
}

run();
