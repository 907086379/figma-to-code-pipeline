#!/usr/bin/env node
"use strict";

/**
 * 把一个 case 写入/更新到 figma-e2e-batch.json（v2），并在需要时输出关系/建议报告。
 *
 * 为什么放在工具链：
 * - batch 是 UI 自动化闭环的一部分，命名/路径模板/信号抽取必须稳定一致
 *
 * 自动命名优先级（可通过配置/参数关闭）：
 * - mcp-raw root data-name（family/variant）
 * - export default function 名称
 * - 回退：FigmaNode<nodeId>（PascalCase 且可追溯）
 *
 * 工程化信号：
 * - 从 mcp-raw 提取 states / assets / iconSemanticKeys / primitiveCandidates
 * - 可写 component-relations.json 与 component-engineering-suggestions.json
 *
 * 用法：
 *   node scripts/batch-add.cjs "<figma-url|cacheKey|node-id>" [--batch=figma-e2e-batch.json] [--fileKey=...] [--target=...] [--target-root=...] [--component=...] [--kind=vue|react|html] [--no-auto-name] [--relations-report=...] [--no-relations-report] [--suggestions-report=...] [--no-suggestions-report]
 */

const fs = require("fs");
const path = require("path");
const { parseCli } = require("./cli-args.cjs");
const { readBatchV2, writeBatchV2, normalizeNodeIdToBatch } = require("./ui/ui-batch-v2.cjs");

const ROOT = process.cwd();
const DEFAULT_BATCH = "figma-e2e-batch.json";
const DEFAULT_UI_BATCH_CONFIG = "figma-ui-batch.config.json";
const DEFAULT_MCP_RAW_FILE = "mcp-raw-get-design-context.txt";
const DEFAULT_RELATIONS_REPORT = "figma-cache/reports/runtime/component-relations.json";
const DEFAULT_SUGGESTIONS_REPORT = "figma-cache/reports/runtime/component-engineering-suggestions.json";

function readJsonIfExists(absPath) {
  if (!fs.existsSync(absPath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function safeReadText(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
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

function resolveNamingConfig() {
  const { config } = readUiBatchConfig();
  const naming = config && config.naming && typeof config.naming === "object" ? config.naming : {};
  return {
    enabled: naming.enabled !== false,
    preferRootDataName: naming.preferRootDataName !== false,
    preferExportDefaultName: naming.preferExportDefaultName !== false,
    useVariantOnCollision: naming.useVariantOnCollision !== false,
    writeRelationsReport: naming.writeRelationsReport !== false,
    relationsReport:
      String(process.env.FIGMA_UI_RELATIONS_REPORT || "").trim() ||
      String(naming.relationsReport || "").trim() ||
      DEFAULT_RELATIONS_REPORT,
    writeSuggestionsReport: naming.writeSuggestionsReport !== false,
    suggestionsReport:
      String(process.env.FIGMA_UI_SUGGESTIONS_REPORT || "").trim() ||
      String(naming.suggestionsReport || "").trim() ||
      DEFAULT_SUGGESTIONS_REPORT,
  };
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeSlash(input) {
  return String(input || "").replace(/\\/g, "/");
}

function uniqueArray(input) {
  return Array.from(new Set((Array.isArray(input) ? input : []).filter(Boolean)));
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

function parseArgs() {
  const { values, flags, positionals } = parseCli(process.argv, {
    strings: [
      "batch",
      "fileKey",
      "nodeId",
      "target",
      "target-root",
      "component",
      "kind",
      "minScore",
      "maxWarnings",
      "maxDiffs",
      "relations-report",
      "suggestions-report",
    ],
    booleanFlags: ["no-auto-name", "no-relations-report", "no-suggestions-report"],
  });
  const out = {
    input: (positionals[0] || "").trim(),
    batch: (values.batch || "").trim() || DEFAULT_BATCH,
    fileKey: (values.fileKey || "").trim(),
    nodeId: "",
    target: (values.target || "").trim(),
    targetRoot: (values["target-root"] || "").trim(),
    component: (values.component || "").trim(),
    kind: (values.kind || "").trim() || "vue",
    minScore: undefined,
    maxWarnings: undefined,
    maxDiffs: undefined,
    relationsReport: (values["relations-report"] || "").trim(),
    suggestionsReport: (values["suggestions-report"] || "").trim(),
    noAutoName: !!flags["no-auto-name"],
    noRelationsReport: !!flags["no-relations-report"],
    noSuggestionsReport: !!flags["no-suggestions-report"],
  };
  const nid = (values.nodeId || "").trim();
  if (nid) out.nodeId = normalizeNodeIdForBatch(nid);
  const ms = (values.minScore || "").trim();
  if (ms) {
    const n = Number(ms);
    if (Number.isFinite(n)) out.minScore = n;
  }
  const mw = (values.maxWarnings || "").trim();
  if (mw) {
    const n = Number(mw);
    if (Number.isFinite(n)) out.maxWarnings = n;
  }
  const md = (values.maxDiffs || "").trim();
  if (md) {
    const n = Number(md);
    if (Number.isFinite(n)) out.maxDiffs = n;
  }
  return out;
}

function inferFileKeyFromExistingBatch(batchAbs) {
  const payload = readJsonIfExists(batchAbs);
  const cases =
    payload && typeof payload === "object" && Array.isArray(payload.cases)
      ? payload.cases
      : Array.isArray(payload)
      ? payload
      : [];
  if (!cases.length) return "";
  const keys = Array.from(new Set(cases.map((x) => String(x && x.designRef && x.designRef.fileKey ? x.designRef.fileKey : "").trim()).filter(Boolean)));
  return keys.length === 1 ? keys[0] : "";
}

function isStrictPascalCase(input) {
  return /^[A-Z][A-Za-z0-9]*$/.test(String(input || "").trim());
}

function toPascalCase(input) {
  const tokens = String(input || "")
    .replace(/[/_]+/g, " ")
    .replace(/[^0-9A-Za-z ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return "";
  return tokens.map((x) => x.slice(0, 1).toUpperCase() + x.slice(1)).join("");
}

function escapeRegExp(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nodeSuffixFromBatchNode(nodeIdBatch) {
  const m = String(nodeIdBatch || "").match(/^(\d+)-(\d+)$/);
  if (m) return `N${m[1]}x${m[2]}`;
  return `N${String(nodeIdBatch || "").replace(/[^0-9A-Za-z]/g, "") || "Unknown"}`;
}

function extractComponentFromTarget(targetEntry) {
  const normalized = String(targetEntry || "").replace(/\\/g, "/");
  const m = normalized.match(/\/([^/]+)\/index\.[^/]+$/);
  return m ? String(m[1] || "").trim() : "";
}

function buildUsageIndex(batchPayload) {
  const base =
    batchPayload && typeof batchPayload === "object" && !Array.isArray(batchPayload)
      ? batchPayload
      : emptyBatchV2();
  const cases = Array.isArray(base.cases) ? base.cases : [];
  const byNodeKey = new Map();
  const byComponent = new Map();
  cases.forEach((item) => {
    const fk = String(item && item.designRef && item.designRef.fileKey ? item.designRef.fileKey : "").trim();
    const nid = normalizeNodeIdForBatch(String(item && item.designRef && item.designRef.nodeId ? item.designRef.nodeId : "").trim());
    const key = fk && nid ? `${fk}#${nid}` : "";
    const comp = extractComponentFromTarget(item && item.target ? item.target.entry : "");
    if (!key || !comp) return;
    byNodeKey.set(key, comp);
    if (!byComponent.has(comp)) byComponent.set(comp, new Set());
    byComponent.get(comp).add(key);
  });
  return { byNodeKey, byComponent };
}

function parseNodeNamingEvidence(rawText, nodeIdBatch) {
  const nodeIdCache = normalizeNodeIdForCacheKey(nodeIdBatch);
  const nodeHit = String(rawText || "").match(
    new RegExp(`data-node-id="${escapeRegExp(nodeIdCache)}"[^\\n]*data-name="([^"]+)"`)
  );
  const rootDataName = nodeHit && nodeHit[1] ? String(nodeHit[1]).trim() : "";
  const rootParts = rootDataName.split("/").map((x) => x.trim()).filter(Boolean);
  const familyRaw = rootParts[0] || "";
  const variantRaw = rootParts.slice(1).join(" ");
  const exportHit = String(rawText || "").match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/);
  const exportDefaultName = exportHit && exportHit[1] ? String(exportHit[1]).trim() : "";

  const variantCandidates = [];
  if (familyRaw) {
    const re = /data-name="([^"]+)"/g;
    let m = re.exec(String(rawText || ""));
    while (m) {
      const full = String(m[1] || "").trim();
      if (full.startsWith(`${familyRaw}/`)) {
        const suffix = full.slice(familyRaw.length + 1).trim();
        if (suffix) variantCandidates.push(suffix);
      }
      m = re.exec(String(rawText || ""));
    }
  }

  const selectedVariant = variantRaw || variantCandidates[0] || "";
  const stateTokens = Array.from(
    new Set(
      String(selectedVariant || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .filter((t) =>
          [
            "default",
            "active",
            "inactive",
            "disabled",
            "hover",
            "focus",
            "pressed",
            "selected",
            "dialpad",
            "mute",
            "record",
            "hold",
            "expanded",
            "collapsed",
          ].includes(t)
        )
    )
  );

  return {
    rootDataName,
    exportDefaultName,
    familyRaw,
    variantRaw: selectedVariant,
    family: toPascalCase(familyRaw),
    variant: toPascalCase(selectedVariant),
    states: stateTokens,
  };
}

function normalizeStateToken(raw) {
  const token = String(raw || "").trim().toLowerCase();
  if (!token) return "";
  const map = {
    normal: "default",
    idle: "default",
    enabled: "default",
    minimised: "minimized",
    minimise: "minimized",
  };
  return map[token] || token;
}

function parseUnionPropLiterals(rawText) {
  const out = [];
  const re = /property\d+\?\s*:\s*([^;]+);/g;
  let m = re.exec(String(rawText || ""));
  while (m) {
    const rhs = String(m[1] || "");
    const quoted = rhs.match(/"([^"]+)"/g) || [];
    quoted.forEach((q) => out.push(String(q).slice(1, -1)));
    m = re.exec(String(rawText || ""));
  }
  return out;
}

function extractAssetSignals(rawText) {
  const assets = [];
  const re = /const\s+([A-Za-z0-9_]+)\s*=\s*"https:\/\/www\.figma\.com\/api\/mcp\/asset\/([a-z0-9-]+)";/g;
  let m = re.exec(String(rawText || ""));
  while (m) {
    assets.push({
      variable: String(m[1] || ""),
      assetId: String(m[2] || ""),
      url: `https://www.figma.com/api/mcp/asset/${String(m[2] || "")}`,
    });
    m = re.exec(String(rawText || ""));
  }
  return assets;
}

function extractIconSemanticKeys(rawText) {
  const out = [];
  const re = /data-name="([^"]*Icon\/[^"]+)"/g;
  let m = re.exec(String(rawText || ""));
  while (m) {
    const full = String(m[1] || "").trim();
    const normalized = full
      .replace(/^H5 Icon\//i, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\//g, ".")
      .replace(/[^a-zA-Z0-9. ]+/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();
    if (normalized) out.push(normalized);
    m = re.exec(String(rawText || ""));
  }
  return uniqueArray(out).sort();
}

function extractPrimitiveCandidates(rawText) {
  const counts = new Map();
  const re = /data-name="([^"]+)"/g;
  let m = re.exec(String(rawText || ""));
  while (m) {
    const name = String(m[1] || "").trim();
    if (!name) {
      m = re.exec(String(rawText || ""));
      continue;
    }
    if (/^H5 Icon\//i.test(name) || /^Vector$/i.test(name)) {
      m = re.exec(String(rawText || ""));
      continue;
    }
    counts.set(name, (counts.get(name) || 0) + 1);
    m = re.exec(String(rawText || ""));
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));
}

function extractEngineeringSignals(rawText, namingInfo) {
  const variantTokens = String(namingInfo && namingInfo.variantRaw ? namingInfo.variantRaw : "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(normalizeStateToken);
  const propTokens = parseUnionPropLiterals(rawText)
    .map((x) => String(x).split(/[^A-Za-z0-9]+/).filter(Boolean))
    .flat()
    .map(normalizeStateToken);
  const states = uniqueArray([...(namingInfo && Array.isArray(namingInfo.states) ? namingInfo.states : []), ...variantTokens, ...propTokens]).sort();
  const iconSemanticKeys = extractIconSemanticKeys(rawText);
  const primitiveCandidates = extractPrimitiveCandidates(rawText);
  const assets = extractAssetSignals(rawText);
  return {
    states,
    iconSemanticKeys,
    primitiveCandidates,
    assets,
  };
}

function selectComponentName(params) {
  const { preferred, fallback, fileKey, nodeIdBatch, usageIndex, namingInfo, namingConfig } = params;
  const nodeKey = `${fileKey}#${nodeIdBatch}`;
  const existing = usageIndex.byNodeKey.get(nodeKey);
  if (existing) return existing;

  const isTakenByOther = (name) => {
    const set = usageIndex.byComponent.get(name);
    if (!set || !set.size) return false;
    return !(set.size === 1 && set.has(nodeKey));
  };

  const base = preferred || fallback;
  if (!isTakenByOther(base)) return base;

  if (namingConfig.useVariantOnCollision && namingInfo && namingInfo.variant) {
    const withVariant = `${base}${namingInfo.variant}`;
    if (!isTakenByOther(withVariant)) return withVariant;
  }

  return `${base}${nodeSuffixFromBatchNode(nodeIdBatch)}`;
}

function resolveAutoNamingContext(fileKey, nodeIdBatch) {
  const safeNodeId = String(nodeIdBatch || "").replace(/:/g, "-");
  const abs = path.join(
    ROOT,
    "figma-cache",
    "files",
    String(fileKey || ""),
    "nodes",
    safeNodeId,
    "mcp-raw",
    DEFAULT_MCP_RAW_FILE
  );
  if (!fs.existsSync(abs)) {
    return { sourcePath: abs, rawText: "", namingInfo: null };
  }
  const rawText = safeReadText(abs);
  const namingInfo = parseNodeNamingEvidence(rawText, nodeIdBatch);
  return { sourcePath: abs, rawText, namingInfo };
}

function readRelationsReport(absPath) {
  const raw = readJsonIfExists(absPath);
  if (!raw || typeof raw !== "object") {
    return { version: 1, generatedAt: "", entries: {}, families: {} };
  }
  return {
    version: 1,
    generatedAt: String(raw.generatedAt || ""),
    entries: raw.entries && typeof raw.entries === "object" ? raw.entries : {},
    families: raw.families && typeof raw.families === "object" ? raw.families : {},
  };
}

function writeRelationsReport(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeSuggestionsReport(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function upsertRelationsEntry(absPath, entry) {
  const report = readRelationsReport(absPath);
  const nodeKey = `${entry.fileKey}#${entry.nodeId}`;
  report.entries[nodeKey] = entry;
  const familyKey = String(entry.family || entry.component || "UnknownFamily");
  if (!report.families[familyKey]) {
    report.families[familyKey] = {
      components: [],
      nodes: [],
      variants: [],
      states: [],
      iconSemanticKeys: [],
      primitiveNames: [],
      assetIds: [],
    };
  }
  const fam = report.families[familyKey];
  fam.components = uniqueArray([...(fam.components || []), entry.component]).sort();
  fam.nodes = uniqueArray([...(fam.nodes || []), nodeKey]).sort();
  fam.variants = uniqueArray([...(fam.variants || []), ...(entry.variant ? [entry.variant] : [])]).sort();
  fam.states = uniqueArray([...(fam.states || []), ...((entry.states || []).map((x) => String(x)))]).sort();
  fam.iconSemanticKeys = uniqueArray([
    ...(fam.iconSemanticKeys || []),
    ...((entry.signals && entry.signals.iconSemanticKeys) || []),
  ]).sort();
  fam.primitiveNames = uniqueArray([
    ...(fam.primitiveNames || []),
    ...((entry.signals && entry.signals.primitiveCandidates) || []).map((x) => String(x && x.name ? x.name : "")),
  ]).sort();
  fam.assetIds = uniqueArray([
    ...(fam.assetIds || []),
    ...((entry.signals && entry.signals.assets) || []).map((x) => String(x && x.assetId ? x.assetId : "")),
  ]).sort();
  report.generatedAt = new Date().toISOString();
  writeRelationsReport(absPath, report);
  return report;
}

function buildEngineeringSuggestions(relationsReport) {
  const report = relationsReport && typeof relationsReport === "object" ? relationsReport : {};
  const entries = report.entries && typeof report.entries === "object" ? report.entries : {};
  const families = report.families && typeof report.families === "object" ? report.families : {};
  const familyToEntries = new Map();
  Object.values(entries).forEach((entry) => {
    const family = String(entry && entry.family ? entry.family : "").trim() || "UnknownFamily";
    if (!familyToEntries.has(family)) familyToEntries.set(family, []);
    familyToEntries.get(family).push(entry);
  });

  const primitiveExtraction = [];
  const iconMapping = [];
  const variantCoverage = [];

  Object.entries(families).forEach(([familyName, familyMeta]) => {
    const nodes = familyToEntries.get(familyName) || [];
    const primitiveWeight = new Map();
    nodes.forEach((entry) => {
      const list = entry && entry.signals && Array.isArray(entry.signals.primitiveCandidates)
        ? entry.signals.primitiveCandidates
        : [];
      list.forEach((item) => {
        const key = String(item && item.name ? item.name : "").trim();
        const count = Number(item && item.count);
        if (!key) return;
        primitiveWeight.set(key, (primitiveWeight.get(key) || 0) + (Number.isFinite(count) ? count : 1));
      });
    });
    Array.from(primitiveWeight.entries())
      .filter(([, weight]) => weight >= 3)
      .sort((a, b) => b[1] - a[1])
      .forEach(([primitiveName, weight]) => {
        primitiveExtraction.push({
          family: familyName,
          primitiveName,
          weight,
          suggestion: `抽取 ${primitiveName} 为共享 primitive，并接入 allowPrimitives 白名单`,
        });
      });

    const iconKeys = uniqueArray(
      nodes.flatMap((entry) =>
        entry && entry.signals && Array.isArray(entry.signals.iconSemanticKeys)
          ? entry.signals.iconSemanticKeys
          : []
      )
    ).sort();
    iconKeys.forEach((semanticKey) => {
      iconMapping.push({
        family: familyName,
        semanticKey,
        suggestion: `在 ui-icon-registry.json 中建立 ${semanticKey} 的稳定映射`,
      });
    });

    const variantNodes = nodes.filter((entry) => String(entry && entry.variant ? entry.variant : "").trim());
    if (nodes.length >= 2 && variantNodes.length < nodes.length) {
      variantCoverage.push({
        family: familyName,
        totalNodes: nodes.length,
        nodesWithVariant: variantNodes.length,
        suggestion: "补齐 data-name 中的 /Variant 标注，避免同 family 的状态语义丢失",
      });
    }
    const familyStates =
      familyMeta && Array.isArray(familyMeta.states)
        ? familyMeta.states.map((x) => String(x)).filter(Boolean)
        : [];
    if (!familyStates.length && nodes.length >= 2) {
      variantCoverage.push({
        family: familyName,
        totalNodes: nodes.length,
        nodesWithVariant: variantNodes.length,
        suggestion: "为该 family 增加状态词（如 default/active/disabled），便于状态机自动化",
      });
    }
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      families: Object.keys(families).length,
      primitiveExtractionCount: primitiveExtraction.length,
      iconMappingCount: iconMapping.length,
      variantCoverageCount: variantCoverage.length,
    },
    suggestions: {
      primitiveExtraction,
      iconMapping,
      variantCoverage,
    },
  };
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

function findCaseByDesignRef(batchPayload, fileKey, nodeIdBatch) {
  const base =
    batchPayload && typeof batchPayload === "object" && !Array.isArray(batchPayload)
      ? batchPayload
      : emptyBatchV2();
  const cases = Array.isArray(base.cases) ? base.cases : [];
  return (
    cases.find(
      (x) =>
        x &&
        x.designRef &&
        String(x.designRef.fileKey || "").trim() === String(fileKey || "").trim() &&
        String(x.designRef.nodeId || "").trim() === String(nodeIdBatch || "").trim()
    ) || null
  );
}

function main() {
  const args = parseArgs();
  const namingConfig = resolveNamingConfig();
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
        "",
        "关系索引：",
        "- 默认输出 figma-cache/reports/runtime/component-relations.json",
        "- 可用 --relations-report=... 覆盖，或 --no-relations-report 关闭",
        "- 建议输出 figma-cache/reports/runtime/component-engineering-suggestions.json",
        "- 可用 --suggestions-report=... 覆盖，或 --no-suggestions-report 关闭",
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

  const nodeIdBatch = normalizeNodeIdForBatch(nodeId);
  const existing = readJsonIfExists(batchAbs);
  const usageIndex = buildUsageIndex(existing);
  const existingCase = findCaseByDesignRef(existing, fileKey, nodeIdBatch);
  const existingLimits =
    existingCase && existingCase.limits && typeof existingCase.limits === "object"
      ? existingCase.limits
      : {};
  const autoContext = resolveAutoNamingContext(fileKey, nodeIdBatch);
  const engineeringSignals = extractEngineeringSignals(autoContext.rawText, autoContext.namingInfo || {});

  let resolvedComponent = String(args.component || "").trim();
  if (!resolvedComponent && !args.noAutoName && namingConfig.enabled) {
    const preferredFromRoot = namingConfig.preferRootDataName && autoContext.namingInfo ? autoContext.namingInfo.family : "";
    const preferredFromExport =
      namingConfig.preferExportDefaultName && autoContext.namingInfo
        ? toPascalCase(autoContext.namingInfo.exportDefaultName)
        : "";
    const preferred = preferredFromRoot || preferredFromExport;
    const fallback = defaultComponentName(nodeIdBatch);
    resolvedComponent = selectComponentName({
      preferred: preferred || fallback,
      fallback,
      fileKey,
      nodeIdBatch,
      usageIndex,
      namingInfo: autoContext.namingInfo,
      namingConfig,
    });
  }

  const componentForTarget = resolvedComponent || defaultComponentName(nodeIdBatch);
  const target = resolveTarget({
    target: args.target,
    component: componentForTarget,
    nodeId,
    targetRoot: args.targetRoot,
  });

  const itemV2 = {
    id: `${kind}-${fileKey}-${nodeIdBatch}`,
    designRef: { fileKey, nodeId: nodeIdBatch },
    target: { kind, entry: target, assets: [] },
    audit: { mode: kind === "html" ? "html-partial" : "web-strict" },
    limits: {
      minScore: Number.isFinite(Number(args.minScore))
        ? Number(args.minScore)
        : Number.isFinite(Number(existingLimits.minScore))
        ? Number(existingLimits.minScore)
        : 85,
      maxWarnings: Number.isFinite(Number(args.maxWarnings))
        ? Number(args.maxWarnings)
        : Number.isFinite(Number(existingLimits.maxWarnings))
        ? Number(existingLimits.maxWarnings)
        : 10,
      maxDiffs: Number.isFinite(Number(args.maxDiffs))
        ? Number(args.maxDiffs)
        : Number.isFinite(Number(existingLimits.maxDiffs))
        ? Number(existingLimits.maxDiffs)
        : 10,
    },
    policy: { allowPrimitives: [] },
    naming: {
      component: componentForTarget,
      family:
        (autoContext.namingInfo && autoContext.namingInfo.family) || toPascalCase(componentForTarget),
      variant: (autoContext.namingInfo && autoContext.namingInfo.variant) || "",
      states: engineeringSignals.states,
      sourceDataName: (autoContext.namingInfo && autoContext.namingInfo.rootDataName) || "",
      sourceExportDefault: (autoContext.namingInfo && autoContext.namingInfo.exportDefaultName) || "",
      derivedBy:
        args.component && isStrictPascalCase(args.component)
          ? "manual-component-arg"
          : autoContext.namingInfo
          ? "toolchain-auto-from-mcp-raw"
          : "toolchain-fallback-node-id",
    },
    signals: {
      iconSemanticKeys: engineeringSignals.iconSemanticKeys,
      primitiveCandidates: engineeringSignals.primitiveCandidates,
      assets: engineeringSignals.assets,
    },
  };

  const { payload, action } = upsertCaseV2(existing, itemV2);
  writeBatchV2(batchAbs, ROOT, payload);

  if (namingConfig.writeRelationsReport && !args.noRelationsReport) {
    const relationsPathInput = String(args.relationsReport || "").trim() || namingConfig.relationsReport;
    const relationsAbs = path.isAbsolute(relationsPathInput)
      ? relationsPathInput
      : path.join(ROOT, relationsPathInput);
    const relationsReport = upsertRelationsEntry(relationsAbs, {
      fileKey,
      nodeId: normalizeNodeIdForCacheKey(nodeIdBatch),
      nodeIdBatch,
      kind,
      component: itemV2.naming.component,
      family: itemV2.naming.family,
      variant: itemV2.naming.variant,
      states: itemV2.naming.states,
      sourceDataName: itemV2.naming.sourceDataName,
      sourceExportDefault: itemV2.naming.sourceExportDefault,
      signals: itemV2.signals,
      targetEntry: itemV2.target.entry,
      batch: normalizeSlash(path.relative(ROOT, batchAbs)),
      updatedAt: new Date().toISOString(),
    });
    if (namingConfig.writeSuggestionsReport && !args.noSuggestionsReport) {
      const suggestionsPathInput = String(args.suggestionsReport || "").trim() || namingConfig.suggestionsReport;
      const suggestionsAbs = path.isAbsolute(suggestionsPathInput)
        ? suggestionsPathInput
        : path.join(ROOT, suggestionsPathInput);
      const suggestionsReport = buildEngineeringSuggestions(relationsReport);
      writeSuggestionsReport(suggestionsAbs, suggestionsReport);
    }
  }

  const cacheKey = `${fileKey}#${normalizeNodeIdForCacheKey(normalizeNodeIdToBatch(nodeIdBatch))}`;
  console.log(`[batch-add] ${action}: ${cacheKey}`);
  console.log(`[batch-add] naming.component: ${itemV2.naming.component}`);
  console.log(`[batch-add] naming.family: ${itemV2.naming.family}`);
  if (itemV2.naming.variant) {
    console.log(`[batch-add] naming.variant: ${itemV2.naming.variant}`);
  }
  if (itemV2.signals.iconSemanticKeys.length) {
    console.log(`[batch-add] signals.icons: ${itemV2.signals.iconSemanticKeys.length}`);
  }
  if (itemV2.signals.primitiveCandidates.length) {
    console.log(`[batch-add] signals.primitives: ${itemV2.signals.primitiveCandidates.length}`);
  }
  console.log(`[batch-add] target.kind: ${kind}`);
  console.log(`[batch-add] target.entry: ${itemV2.target.entry}`);
}

main();

