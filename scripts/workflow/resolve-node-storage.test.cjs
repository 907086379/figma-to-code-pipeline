#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  sanitizeNodeId,
  normalizeNodeSegment,
  resolveNodeDirRel,
  resolveNodeDirAbs,
} = require("./resolve-node-storage.cjs");

test("sanitizeNodeId replaces colon with dash", () => {
  assert.strictEqual(sanitizeNodeId("3710:5718"), "3710-5718");
});

test("normalizeNodeSegment trims slashes and allows nested names", () => {
  assert.strictEqual(normalizeNodeSegment("sip"), "sip");
  assert.strictEqual(normalizeNodeSegment("/input/"), "input");
  assert.strictEqual(normalizeNodeSegment("toggle switch"), "toggle switch");
  assert.throws(() => normalizeNodeSegment("../evil"), /forbidden segment/);
});

test("resolveNodeDirRel default path without segment or index", () => {
  const rel = resolveNodeDirRel({
    fileKey: "abc123",
    nodeId: "12:34",
    cacheDirAbs: "/tmp/cache",
    indexJsonPath: "/tmp/cache/missing-index.json",
  });
  assert.strictEqual(rel, "files/abc123/nodes/12-34");
});

test("resolveNodeDirRel honors explicit nodeSegment", () => {
  const rel = resolveNodeDirRel({
    fileKey: "abc123",
    nodeId: "12:34",
    nodeSegment: "sip",
    cacheDirAbs: "/tmp/cache",
  });
  assert.strictEqual(rel, "files/abc123/nodes/sip/12-34");
});

test("resolveNodeDirRel reads existing index paths.meta", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-resolve-node-"));
  const cacheDir = path.join(tmp, "figma-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const nodeDir = path.join(cacheDir, "files", "fk1", "nodes", "input", "99-88");
  fs.mkdirSync(nodeDir, { recursive: true });
  const metaAbs = path.join(nodeDir, "meta.json");
  fs.writeFileSync(metaAbs, "{}", "utf8");
  const indexPath = path.join(cacheDir, "index.json");
  fs.writeFileSync(
    indexPath,
    JSON.stringify({
      items: {
        "fk1#99:88": {
          paths: { meta: metaAbs },
        },
      },
    }),
    "utf8",
  );

  const rel = resolveNodeDirRel({
    fileKey: "fk1",
    nodeId: "99:88",
    cacheDirAbs: cacheDir,
    indexJsonPath: indexPath,
  });
  assert.strictEqual(rel, "files/fk1/nodes/input/99-88");

  const abs = resolveNodeDirAbs({
    fileKey: "fk1",
    nodeId: "99:88",
    cacheDirAbs: cacheDir,
    indexJsonPath: indexPath,
  });
  assert.strictEqual(abs, nodeDir);

  fs.rmSync(tmp, { recursive: true, force: true });
});
