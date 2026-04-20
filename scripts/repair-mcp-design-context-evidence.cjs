#!/usr/bin/env node
"use strict";

/**
 * Re-sanitize existing mcp-raw-get-design-context.txt under a tree and refresh
 * mcp-raw-manifest.json get_design_context hashes/sizes when present.
 *
 * Usage:
 *   node scripts/repair-mcp-design-context-evidence.cjs [--root=<dir>]
 *
 * Default --root is process.cwd().
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { sanitizeDesignContextTextForCache } = require("./sanitize-design-context-for-cache.cjs");

function sha256Utf8(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function sizeUtf8(text) {
  return Buffer.byteLength(String(text || ""), "utf8");
}

function parseArgs(argv) {
  let root = process.cwd();
  argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--root=")) root = arg.split("=").slice(1).join("=").trim() || root;
  });
  return { root: path.resolve(root) };
}

function collectDesignContextFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectDesignContextFiles(abs, out);
    } else if (ent.name === "mcp-raw-get-design-context.txt" && path.basename(dir) === "mcp-raw") {
      out.push(abs);
    }
  }
}

function main() {
  const { root } = parseArgs(process.argv);
  const targets = [];
  collectDesignContextFiles(root, targets);
  let changed = 0;
  for (const abs of targets) {
    const before = fs.readFileSync(abs, "utf8");
    const after = sanitizeDesignContextTextForCache(before);
    if (after === before) continue;
    fs.writeFileSync(abs, after, "utf8");
    changed += 1;
    const manifestAbs = path.join(path.dirname(abs), "mcp-raw-manifest.json");
    if (fs.existsSync(manifestAbs)) {
      const raw = fs.readFileSync(manifestAbs, "utf8");
      let manifest;
      try {
        manifest = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!manifest || typeof manifest !== "object") continue;
      if (!manifest.fileHashes) manifest.fileHashes = {};
      if (!manifest.fileSizes) manifest.fileSizes = {};
      manifest.fileHashes.get_design_context = sha256Utf8(after);
      manifest.fileSizes.get_design_context = sizeUtf8(after);
      fs.writeFileSync(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }
  }
  console.log(`[repair-mcp-design-context-evidence] scanned under ${root}; updated ${changed} file(s)`);
}

main();
