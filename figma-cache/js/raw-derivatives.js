"use strict";

/**
 * MCP raw → raw.json 派生字段的纯函数（无 fs），供 entry-files hydrate 与 CLI merge 脚本复用。
 */

/**
 * 从 get_design_context 文本中扫描与 Figma Dev Mode / MCP 一致的 `data-annotations="…"`（与 `data-node-id` 同标签），
 * 不依赖 MCP 尾部附录（该段由 ingest 消毒裁掉）。
 * @param {string} designContextText
 * @returns {{ schemaVersion: number, extractionMethod: string, items: Array<{ nodeId: string, name?: string, text: string }> }}
 */
function extractFigmaDataAnnotationsFromDesignContext(designContextText) {
  const text = String(designContextText || "");
  const items = [];
  const seen = new Set();
  let searchFrom = 0;

  while (true) {
    const daIdx = text.indexOf("data-annotations", searchFrom);
    if (daIdx === -1) break;
    const tagOpen = text.lastIndexOf("<", daIdx);
    if (tagOpen === -1 || daIdx - tagOpen > 4000) {
      searchFrom = daIdx + 17;
      continue;
    }
    const tagClose = text.indexOf(">", daIdx);
    if (tagClose === -1) break;
    const tagSlice = text.slice(tagOpen, tagClose + 1);
    if (/^<\s*\//.test(tagSlice)) {
      searchFrom = daIdx + 17;
      continue;
    }

    let annRaw = null;
    let m = tagSlice.match(/\bdata-annotations\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (m) annRaw = m[1];
    else {
      m = tagSlice.match(/\bdata-annotations\s*=\s*'((?:[^'\\]|\\.)*)'/);
      if (m) annRaw = m[1];
    }
    if (annRaw == null) {
      searchFrom = daIdx + 17;
      continue;
    }
    const ann = unescapeJsxAttrValue(String(annRaw));
    if (!ann.trim()) {
      searchFrom = daIdx + 17;
      continue;
    }

    const nodeId = readJsxStringAttrFromOpenTag(tagSlice, "data-node-id").trim();
    const name = readJsxStringAttrFromOpenTag(tagSlice, "data-name").trim();

    const key = `${nodeId}\0${ann}`;
    if (!seen.has(key)) {
      seen.add(key);
      const row = { nodeId, text: ann };
      if (name) row.name = name;
      items.push(row);
    }
    searchFrom = tagClose + 1;
  }

  return {
    schemaVersion: 1,
    extractionMethod: "data_annotations_attr_scan_v1",
    items,
  };
}

function unescapeJsxAttrValue(s) {
  return String(s || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

/** 仅从开标签片段读取简单字符串属性（双引号或单引号 + JSX 常见转义）；attrName 须为字面量如 data-node-id */
function readJsxStringAttrFromOpenTag(tagSlice, attrName) {
  const name = String(attrName || "").trim();
  if (!name || /[^\w-]/.test(name)) {
    return "";
  }
  const reDouble = new RegExp(`\\b${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const reSingle = new RegExp(`\\b${name}\\s*=\\s*'((?:[^'\\\\]|\\\\.)*)'`);
  let m = tagSlice.match(reDouble);
  if (m) return unescapeJsxAttrValue(m[1]);
  m = tagSlice.match(reSingle);
  if (m) return unescapeJsxAttrValue(m[1]);
  return "";
}

function mergeLayoutMetricsFromGeometry(raw, geometry) {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  if (!geometry || typeof geometry !== "object" || !Array.isArray(geometry.metrics)) {
    return raw;
  }
  if (!geometry.metrics.length) {
    return raw;
  }
  const existing = Array.isArray(raw.layoutMetrics) ? raw.layoutMetrics : [];
  const byId = new Map(
    existing.map((m) => [String(m && m.id ? m.id : "").trim(), m]).filter(([k]) => k)
  );
  geometry.metrics.forEach((m) => {
    const id = String(m && m.id ? m.id : "").trim();
    if (!id) return;
    byId.set(id, m);
  });
  raw.layoutMetrics = Array.from(byId.values()).sort((a, b) =>
    String(a.id).localeCompare(String(b.id))
  );
  return raw;
}

function buildEvidenceSummary(input) {
  const {
    designContextText = "",
    metadataText = "",
    variableDefs = null,
    nodeId = "",
    geometryFilePresent = false,
    iconMetricsCount = 0,
    layoutMetricsCount = 0,
    figmaDataAnnotationCount = 0,
  } = input || {};

  const dc = String(designContextText);
  const meta = String(metadataText);
  const designContextBytes = Buffer.byteLength(dc, "utf8");
  const metadataBytes = Buffer.byteLength(meta, "utf8");
  const dataNodeIdRefs = (dc.match(/data-node-id="/g) || []).length;
  const scopeNodeId = String(nodeId || "").trim();
  const dataNodeIdContainsScope =
    scopeNodeId && dc.length ? dc.includes(`data-node-id="${scopeNodeId}"`) : null;
  const designContextImgConstDefinitions = (
    dc.match(/\bconst\s+img[A-Za-z0-9_]*\s*=\s*"https:\/\/www\.figma\.com\/api\/mcp\/asset\//g) || []
  ).length;
  const imgTagOccurrences = (dc.match(/<img\b/gi) || []).length;
  const figmaAssetUrlOccurrences = (dc.match(/https:\/\/www\.figma\.com\/api\/mcp\/asset\//g) || []).length;
  const approximateHexColorLiterals = (
    dc.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g) || []
  ).length;
  const variableDefKeys =
    variableDefs && typeof variableDefs === "object" && !Array.isArray(variableDefs)
      ? Object.keys(variableDefs).length
      : 0;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    designContextBytes,
    metadataBytes,
    dataNodeIdRefs,
    dataNodeIdContainsScope,
    designContextImgConstDefinitions,
    imgTagOccurrences,
    figmaAssetUrlOccurrences,
    approximateHexColorLiterals,
    variableDefKeys,
    geometryFilePresent,
    iconMetricsCount,
    layoutMetricsCount,
    figmaDataAnnotationCount: Number(figmaDataAnnotationCount) || 0,
  };
}

module.exports = {
  mergeLayoutMetricsFromGeometry,
  buildEvidenceSummary,
  extractFigmaDataAnnotationsFromDesignContext,
};
