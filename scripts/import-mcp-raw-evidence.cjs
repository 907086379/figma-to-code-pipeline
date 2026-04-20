#!/usr/bin/env node
"use strict";

/**
 * Import MCP raw evidence files into figma-cache node directory and generate a manifest.
 *
 * This is the toolchain-friendly way to implement: "call MCP once -> cache evidence".
 *
 * Usage:
 *   node scripts/import-mcp-raw-evidence.cjs \
 *     --cacheKey=<fileKey#nodeId> \
 *     --design-context=<path/to/get_design_context.txt> \
 *     --metadata=<path/to/get_metadata.txt> \
 *     --variable-defs=<path/to/get_variable_defs.json>
 *
 * Notes:
 * - Writes to: figma-cache/files/<fileKey>/nodes/<safeNodeId>/mcp-raw/
 * - Generates: mcp-raw-manifest.json with sha256 + byte sizes
 * - get_design_context: normalized via sanitize-design-context-for-cache.cjs
 *   (MCP trailers like SUPER CRITICAL, token prose, component-doc blobs; variable-font style noise).
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

function readUtf8(absPath) {
  return fs.readFileSync(absPath, "utf8");
}

function resolveAbs(p) {
  const v = String(p || "").trim();
  if (!v) return "";
  return path.isAbsolute(v) ? v : path.join(process.cwd(), v);
}

function normalizeNodeId(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.includes(":") ? value : value.replace(/-/g, ":");
}

function parseArgs(argv) {
  const out = {
    cacheKey: "",
    designContext: "",
    metadata: "",
    variableDefs: "",
  };
  argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--cacheKey=")) out.cacheKey = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--design-context="))
      out.designContext = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--metadata=")) out.metadata = arg.split("=").slice(1).join("=").trim();
    if (arg.startsWith("--variable-defs="))
      out.variableDefs = arg.split("=").slice(1).join("=").trim();
  });
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.cacheKey || !args.designContext || !args.metadata || !args.variableDefs) {
    console.error(
      "Usage: node scripts/import-mcp-raw-evidence.cjs --cacheKey=<fileKey#nodeId> --design-context=<txt> --metadata=<txt> --variable-defs=<json>"
    );
    process.exit(2);
  }

  const cacheKey = String(args.cacheKey).trim();
  const [fileKey, nodeIdRaw] = cacheKey.split("#");
  const nodeId = normalizeNodeId(nodeIdRaw);
  if (!fileKey || !nodeId) {
    console.error(`[import-mcp-raw-evidence] invalid cacheKey: ${cacheKey}`);
    process.exit(2);
  }

  const safeNodeDir = nodeId.replace(/:/g, "-");
  const mcpRawDir = path.join(
    process.cwd(),
    "figma-cache",
    "files",
    fileKey,
    "nodes",
    safeNodeDir,
    "mcp-raw"
  );
  fs.mkdirSync(mcpRawDir, { recursive: true });

  const srcDesign = resolveAbs(args.designContext);
  const srcMeta = resolveAbs(args.metadata);
  const srcVars = resolveAbs(args.variableDefs);
  if (!fs.existsSync(srcDesign) || !fs.existsSync(srcMeta) || !fs.existsSync(srcVars)) {
    console.error("[import-mcp-raw-evidence] missing input file(s)");
    process.exit(2);
  }

  const files = {
    get_design_context: "mcp-raw-get-design-context.txt",
    get_metadata: "mcp-raw-get-metadata.txt",
    get_variable_defs: "mcp-raw-get-variable-defs.json",
  };

  const contents = {
    get_design_context: sanitizeDesignContextTextForCache(readUtf8(srcDesign)),
    get_metadata: readUtf8(srcMeta),
    get_variable_defs: readUtf8(srcVars),
  };

  fs.writeFileSync(path.join(mcpRawDir, files.get_design_context), contents.get_design_context, "utf8");
  fs.writeFileSync(path.join(mcpRawDir, files.get_metadata), contents.get_metadata, "utf8");
  fs.writeFileSync(path.join(mcpRawDir, files.get_variable_defs), contents.get_variable_defs, "utf8");

  const manifest = {
    mcpServer: "plugin-figma-figma",
    fileKey,
    nodeId,
    files,
    fileHashes: Object.fromEntries(Object.entries(contents).map(([k, v]) => [k, sha256Utf8(v)])),
    fileSizes: Object.fromEntries(Object.entries(contents).map(([k, v]) => [k, sizeUtf8(v)])),
  };

  fs.writeFileSync(
    path.join(mcpRawDir, "mcp-raw-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `[import-mcp-raw-evidence] ok -> ${path.join(mcpRawDir, "mcp-raw-manifest.json")}`
  );
}

main();

