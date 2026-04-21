#!/usr/bin/env node
"use strict";

/**
 * 把一个 case 写入/更新到 figma-e2e-batch.json（v2）。
 *
 * 为什么放在工具链：
 * - batch 是 UI 自动化闭环的一部分，命名/路径模板必须稳定一致
 *
 * 默认命名（无业务语义名时）：
 * - nodeId 9277-28654 -> FigmaNode9277x28654（严格 PascalCase 且可追溯 node-id）
 *
 * 用法：
 *   node scripts/batch-add.cjs "<figma-url|cacheKey|node-id>" [--batch=figma-e2e-batch.json] [--fileKey=...] [--target=...] [--target-root=...] [--component=...] [--kind=vue|react|html]
 */

const fs = require("fs");
const path = require("path");
const { readBatchV2, writeBatchV2, normalizeNodeIdToBatch } = require("./ui-batch-v2.cjs");

const ROOT = process.cwd();
const DEFAULT_BATCH = "figma-e2e-batch.json";
const DEFAULT_UI_BATCH_CONFIG = "figma-ui-batch.config.json";

function readJsonIfExists(absPath) {
  if (!fs.existsSync(absPath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readUiBatchConfig() {
  const configPath = path.join(ROOT, DEFAULT_UI_BATCH_CONFIG);
  const raw = readJsonIfExists(configPath);
  if (!raw || typeof raw !== "object") {
    return { configPath, config: null };
  }
  const config = raw && raw.uiBatch && typeof raw.uiBatch === "object" ? raw.uiBatch : raw;
  if (!config || typeof config !== "object") {
    return { configPath, config: null };
  }
  return { configPath, config };
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeNodeIdForBatch(nodeId) {
  const raw = String(nodeId || "").trim();
  if (!raw) return "";
  // Batch uses Figma URL style: 9278-30676
  return raw.includes("-") ? raw : raw.replace(/:/g, "-");
}

function normalizeNodeIdForCacheKey(nodeId) {
  const raw = String(nodeId || "").trim();
  if (!raw) return "";
  // cacheKey uses 9278:30676
  return raw.includes(":") ? raw : raw.replace(/-/g, ":");
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
  if (!raw) return undefined;
  const m1 = raw.match(/node-id=([0-9]+-[0-9]+)/);
  if (m1) return { nodeId: normalizeNodeIdForBatch(m1[1]) };
  const m2 = raw.match(/^(\d+[-:]\d+)$/);
  if (m2) return { nodeId: normalizeNodeIdForBatch(m2[1]) };
  return undefined;
}

function parseArgs(argv) {
  const out = {
    input: "",
    batch: DEFAULT_BATCH,
    fileKey: "",
    nodeId: "",
    target: "",
    targetRoot: "",
    component: "",
    kind: "vue",
    minScore: 85,
    maxWarnings: 10,
    maxDiffs: 10,
  };

  const raw = argv.slice(2);
  out.input = raw[0] ? String(raw[0]).trim() : "";

  raw.slice(1).forEach((arg) => {
    if (arg.startsWith("--batch=")) out.batch = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--fileKey=")) out.fileKey = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--nodeId="))
      out.nodeId = normalizeNodeIdForBatch(arg.split("=").slice(1).join("=").trim());
    else if (arg.startsWith("--target=")) out.target = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--target-root=")) out.targetRoot = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--component=")) out.component = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--kind=")) out.kind = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--minScore=")) out.minScore = Number(arg.split("=").slice(1).join("=").trim());
    else if (arg.startsWith("--maxWarnings="))
      out.maxWarnings = Number(arg.split("=").slice(1).join("=").trim());
    else if (arg.startsWith("--maxDiffs=")) out.maxDiffs = Number(arg.split("=").slice(1).join("=").trim());
  });

  return out;
}

function inferFileKeyFromExistingBatch(batchAbs) {
  const payload = readJsonIfExists(batchAbs);
  if (!Array.isArray(payload) || payload.length === 0) return "";
  const keys = Array.from(
    new Set(payload.map((x) => (x && x.fileKey ? String(x.fileKey).trim() : "")).filter(Boolean))
  );
  return keys.length === 1 ? keys[0] : "";
}

function isStrictPascalCase(input) {
  return /^[A-Z][A-Za-z0-9]*$/.test(String(input || "").trim());
}

function defaultComponentName(nodeIdBatch) {
  const raw = String(nodeIdBatch || "").trim();
  const m = raw.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (m) return `FigmaNode${m[1]}x${m[2]}`;
  const safe = raw.replace(/[^0-9A-Za-z]+/g, "");
  return `FigmaNode${safe || "Unknown"}`;
}

function normalizeTargetRoot(input) {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function renderTargetTemplate(template, vars) {
  const raw = String(template || "");
  if (!raw) return "";
  // Simple token replacement; keeps script dependency-free.
  return raw
    .replace(/\{targetRoot\}/g, String(vars.targetRoot || ""))
    .replace(/\{component\}/g, String(vars.component || ""))
    .replace(/\{fileKey\}/g, String(vars.fileKey || ""))
    .replace(/\{nodeId\}/g, String(vars.nodeId || ""));
}

function resolveTarget({ target, component, nodeId, targetRoot }) {
  if (target) return target;
  const comp = component || defaultComponentName(nodeId);
  const { config } = readUiBatchConfig();
  const resolvedRoot =
    normalizeTargetRoot(targetRoot) ||
    normalizeTargetRoot(process.env.FIGMA_UI_BATCH_TARGET_ROOT) ||
    normalizeTargetRoot(config && config.targetRoot) ||
    "./src/pages/main/components";

  const resolvedTemplate =
    String(process.env.FIGMA_UI_BATCH_TARGET_TEMPLATE || "").trim() ||
    String(config && config.targetTemplate ? config.targetTemplate : "").trim() ||
    "{targetRoot}/{component}/index.vue";

  const rendered = renderTargetTemplate(resolvedTemplate, {
    targetRoot: resolvedRoot,
    component: comp,
    nodeId: normalizeNodeIdForBatch(nodeId),
  }).replace(/\\/g, "/");

  if (!rendered || !rendered.includes(String(comp))) {
    // Safety fallback: never emit an empty / suspicious target.
    return `${resolvedRoot}/${comp}/index.vue`;
  }

  return rendered;
}

function emptyBatchV2() {
  return { version: 2, cases: [] };
}

function upsertCaseV2(batchPayload, nextCase) {
  const base =
    batchPayload && typeof batchPayload === "object" && !Array.isArray(batchPayload) ? batchPayload : emptyBatchV2();
  const cases = Array.isArray(base.cases) ? [...base.cases] : [];
  const fk = String(nextCase.designRef.fileKey || "").trim();
  const nid = String(nextCase.designRef.nodeId || "").trim();
  const idx = cases.findIndex(
    (x) =>
      x &&
      x.designRef &&
      String(x.designRef.fileKey || "").trim() === fk &&
      String(x.designRef.nodeId || "").trim() === nid
  );
  if (idx >= 0) {
    cases[idx] = { ...cases[idx], ...nextCase };
    return { payload: { ...base, version: 2, cases }, action: "updated" };
  }
  cases.push(nextCase);
  return { payload: { ...base, version: 2, cases }, action: "added" };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error(
      [
        "用法：",
        '  node scripts/batch-add.cjs "<figma-url|cacheKey|node-id>" [--fileKey=...] [--target=...] [--target-root=...] [--component=...] [--kind=vue|react|html]',
        "",
        "组件命名：",
        "- 默认严格 PascalCase 且可追溯 node-id，例如 9277-28654 -> FigmaNode9277x28654",
        "- 若传 --component，必须严格 PascalCase（A-Z 开头，后续仅字母数字）。",
        "",
        "target.entry 路径：",
        "- 默认写入 ./src/pages/main/components/<Component>/index.vue（kind=vue）",
        "- 你可以用 --target 显式指定 entry，或用 --target-root 改根目录",
        "- 可设置环境变量 FIGMA_UI_BATCH_TARGET_ROOT 避免重复传 --target-root",
        "- 工程化配置：在项目根新增 figma-ui-batch.config.json：",
        '  { "uiBatch": { "targetRoot": "./src/ui/components", "targetTemplate": "{targetRoot}/{component}/index.vue" } }',
        "- 环境变量覆盖模板：FIGMA_UI_BATCH_TARGET_TEMPLATE",
        "",
        "示例：",
        '  node scripts/batch-add.cjs "https://www.figma.com/design/<fileKey>/...?node-id=9278-30676" --kind=vue',
        '  node scripts/batch-add.cjs "53hw0wDvgOzH14DXSsnEmE#9278:30676" --kind=vue',
        '  node scripts/batch-add.cjs "9278-30676" --fileKey=53hw0wDvgOzH14DXSsnEmE --kind=vue',
        '  node scripts/batch-add.cjs "9278-30676" --fileKey=53hw0wDvgOzH14DXSsnEmE --target-root=./src/ui/components --kind=vue',
      ].join("\n")
    );
    process.exit(2);
  }

  const batchAbs = path.isAbsolute(args.batch) ? path.normalize(args.batch) : path.join(ROOT, args.batch);

  const parsed = tryParseFigmaUrl(args.input) || tryParseCacheKey(args.input) || tryParseNodeIdOnly(args.input);

  const fileKey =
    String(args.fileKey || "").trim() ||
    (parsed && parsed.fileKey ? String(parsed.fileKey).trim() : "") ||
    inferFileKeyFromExistingBatch(batchAbs);

  const nodeId = String(args.nodeId || "").trim() || (parsed && parsed.nodeId ? String(parsed.nodeId).trim() : "");

  if (!fileKey) {
    console.error(
      [
        "missing fileKey.",
        "- provide a full Figma URL that includes /design/<fileKey> and ?node-id=...",
        "- or provide cacheKey like <fileKey>#9278:30676",
        "- or pass --fileKey=... when using node-id only",
      ].join("\n")
    );
    process.exit(2);
  }

  if (!nodeId) {
    console.error("missing nodeId (expected node-id like 9278-30676 or 9278:30676)");
    process.exit(2);
  }

  const kind = String(args.kind || "").trim() || "vue";
  if (!["vue", "react", "html"].includes(kind)) {
    console.error(`invalid --kind (must be vue|react|html). received: ${JSON.stringify(args.kind)}`);
    process.exit(2);
  }

  if (args.component && !isStrictPascalCase(args.component)) {
    console.error(
      [
        "invalid --component (must be strict PascalCase).",
        `- received: ${JSON.stringify(args.component)}`,
        "- examples: AudioSettingsPanel, CallingWidgetInCallPanel, FigmaNode9277x28654",
      ].join("\n")
    );
    process.exit(2);
  }

  const target = resolveTarget({
    target: args.target,
    component: args.component,
    nodeId,
    targetRoot: args.targetRoot,
  });

  const nodeIdBatch = normalizeNodeIdForBatch(nodeId);
  const itemV2 = {
    id: `${kind}-${fileKey}-${nodeIdBatch}`,
    designRef: { fileKey, nodeId: nodeIdBatch },
    target: { kind, entry: target, assets: [] },
    audit: { mode: kind === "html" ? "html-partial" : "web-strict" },
    limits: {
      minScore: Number.isFinite(Number(args.minScore)) ? Number(args.minScore) : 85,
      maxWarnings: Number.isFinite(Number(args.maxWarnings)) ? Number(args.maxWarnings) : 10,
      maxDiffs: Number.isFinite(Number(args.maxDiffs)) ? Number(args.maxDiffs) : 10,
    },
    policy: { allowPrimitives: [] },
  };

  const existing = readJsonIfExists(batchAbs);
  const { payload, action } = upsertCaseV2(existing, itemV2);
  writeBatchV2(batchAbs, ROOT, payload);

  const cacheKey = `${fileKey}#${normalizeNodeIdForCacheKey(normalizeNodeIdToBatch(nodeIdBatch))}`;
  console.log(`[batch-add] ${action}: ${cacheKey}`);
  console.log(`[batch-add] target.kind: ${kind}`);
  console.log(`[batch-add] target.entry: ${itemV2.target.entry}`);
}

main();

