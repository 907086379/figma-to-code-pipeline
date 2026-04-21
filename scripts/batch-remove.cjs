#!/usr/bin/env node
"use strict";

/**
 * 从 figma-e2e-batch.json（v2）移除一个 case（按 designRef.fileKey + designRef.nodeId 匹配）。
 *
 * Usage:
 *   node scripts/batch-remove.cjs "<figma-url|cacheKey|node-id>" [--batch=figma-e2e-batch.json] [--fileKey=...]
 */

const fs = require("fs");
const path = require("path");
const { writeBatchV2 } = require("./ui-batch-v2.cjs");

const ROOT = process.cwd();
const DEFAULT_BATCH = "figma-e2e-batch.json";

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeNodeIdForBatch(nodeId) {
  const raw = String(nodeId || "").trim();
  if (!raw) return "";
  return raw.includes("-") ? raw : raw.replace(/:/g, "-");
}

function tryParseFigmaUrl(input) {
  try {
    const url = new URL(String(input));
    const m = url.pathname.match(/^\/design\/([^/]+)/);
    const fileKey = m ? m[1] : "";
    const nodeId = url.searchParams.get("node-id") || "";
    if (!fileKey || !nodeId) return undefined;
    return { fileKey, nodeId: normalizeNodeIdForBatch(nodeId) };
  } catch {
    return undefined;
  }
}

function tryParseCacheKey(input) {
  const raw = String(input || "").trim();
  const m = raw.match(/^([A-Za-z0-9]+)#(\d+[:\-]\d+)$/);
  if (!m) return undefined;
  return { fileKey: m[1], nodeId: normalizeNodeIdForBatch(m[2]) };
}

function tryParseNodeIdOnly(input) {
  const raw = String(input || "").trim();
  const m1 = raw.match(/node-id=([0-9]+-[0-9]+)/);
  if (m1) return { nodeId: normalizeNodeIdForBatch(m1[1]) };
  const m2 = raw.match(/^(\d+[-:]\d+)$/);
  if (m2) return { nodeId: normalizeNodeIdForBatch(m2[1]) };
  return undefined;
}

function parseArgs(argv) {
  const out = { input: "", batch: DEFAULT_BATCH, fileKey: "", nodeId: "" };
  const raw = argv.slice(2);
  out.input = raw[0] ? String(raw[0]).trim() : "";
  raw.slice(1).forEach((arg) => {
    if (arg.startsWith("--batch=")) out.batch = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--fileKey=")) out.fileKey = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--nodeId="))
      out.nodeId = normalizeNodeIdForBatch(arg.split("=").slice(1).join("=").trim());
  });
  return out;
}

function inferFileKeyFromExistingBatch(batchPayload) {
  if (!Array.isArray(batchPayload) || batchPayload.length === 0) return "";
  const keys = Array.from(
    new Set(batchPayload.map((x) => (x && x.fileKey ? String(x.fileKey).trim() : "")).filter(Boolean))
  );
  return keys.length === 1 ? keys[0] : "";
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error(
      [
        "用法：",
        '  node scripts/batch-remove.cjs "<figma-url|cacheKey|node-id>" [--fileKey=...]',
        "",
        "示例：",
        '  node scripts/batch-remove.cjs "https://www.figma.com/design/<fileKey>/...?node-id=9278-30676"',
        '  node scripts/batch-remove.cjs "53hw0wDvgOzH14DXSsnEmE#9278:30676"',
        '  node scripts/batch-remove.cjs "9278-30676" --fileKey=53hw0wDvgOzH14DXSsnEmE',
      ].join("\n")
    );
    process.exit(2);
  }

  const batchAbs = path.isAbsolute(args.batch) ? path.normalize(args.batch) : path.join(ROOT, args.batch);
  if (!fs.existsSync(batchAbs)) {
    console.error(`batch file missing: ${batchAbs}`);
    process.exit(2);
  }

  const payload = readJson(batchAbs);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    console.error("batch(v2) 顶层必须是对象：{ version:2, cases:[...] }");
    process.exit(2);
  }
  if (Number(payload.version) !== 2) {
    console.error(`batch(v2) version 必须为 2，实际：${JSON.stringify(payload.version)}`);
    process.exit(2);
  }
  const cases = Array.isArray(payload.cases) ? payload.cases : [];

  const parsed = tryParseFigmaUrl(args.input) || tryParseCacheKey(args.input) || tryParseNodeIdOnly(args.input);

  const fileKey =
    String(args.fileKey || "").trim() ||
    (parsed && parsed.fileKey ? String(parsed.fileKey).trim() : "") ||
    inferFileKeyFromExistingBatch(payload);

  const nodeId = String(args.nodeId || "").trim() || (parsed && parsed.nodeId ? String(parsed.nodeId).trim() : "");

  if (!fileKey) {
    console.error("missing fileKey (provide full URL / cacheKey / --fileKey=...)");
    process.exit(2);
  }
  if (!nodeId) {
    console.error("missing nodeId (expected node-id like 9278-30676 or 9278:30676)");
    process.exit(2);
  }

  const normalizedNodeId = normalizeNodeIdForBatch(nodeId);
  const before = cases.length;
  const nextCases = cases.filter(
    (x) =>
      !(
        x &&
        x.designRef &&
        String(x.designRef.fileKey || "").trim() === fileKey &&
        String(x.designRef.nodeId || "").trim() === normalizedNodeId
      )
  );
  const removed = before - nextCases.length;
  const next = { ...payload, version: 2, cases: nextCases };
  writeBatchV2(batchAbs, ROOT, next);
  console.log(`[batch-remove] removed=${removed}`);
}

main();

