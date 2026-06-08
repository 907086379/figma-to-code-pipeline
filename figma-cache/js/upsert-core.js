/* eslint-disable no-console */

function createUpsertService(deps) {
  const {
    URL,
    NORMALIZATION_VERSION,
    CACHE_BASE_FOR_STORAGE,
    DEFAULT_COMPLETENESS,
    normalizeCompletenessList,
    normalizeIndexShape,
    readIndex,
    getItem,
    writeIndex,
  } = deps;

  function resolveCompleteness(extra, oldItem) {
    const normalizedExtra = normalizeCompletenessList(extra && extra.completeness);
    if (
      extra &&
      Object.prototype.hasOwnProperty.call(extra, "completeness") &&
      normalizedExtra.length
    ) {
      return normalizedExtra;
    }
    if (
      extra &&
      Object.prototype.hasOwnProperty.call(extra, "completeness") &&
      Array.isArray(extra.completeness)
    ) {
      return [];
    }
    if (oldItem && Array.isArray(oldItem.completeness) && oldItem.completeness.length) {
      return normalizeCompletenessList(oldItem.completeness);
    }
    return [...DEFAULT_COMPLETENESS];
  }

  function sanitizeNodeId(nodeId) {
    return String(nodeId).replace(/:/g, "-");
  }

  function normalizeNodeIdValue(nodeId) {
    const raw = String(nodeId).trim();
    const dashPattern = /^(\d+)-(\d+)$/;
    if (dashPattern.test(raw)) {
      return raw.replace(dashPattern, "$1:$2");
    }
    return raw;
  }

  function normalizeFigmaUrl(inputUrl) {
    let parsed;
    try {
      parsed = new URL(inputUrl);
    } catch {
      throw new Error(`Invalid URL: ${inputUrl}`);
    }

    const hostOk = /(^|\.)figma\.com$/i.test(parsed.hostname);
    if (!hostOk) {
      throw new Error(`Non-Figma domain: ${parsed.hostname}`);
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const routeType = parts[0];
    const fileKey = parts[1];
    if (!["file", "design"].includes(routeType) || !fileKey) {
      throw new Error(`Cannot extract fileKey from path: ${parsed.pathname}`);
    }

    const nodeIdRaw = parsed.searchParams.get("node-id");
    const nodeId = nodeIdRaw ? normalizeNodeIdValue(decodeURIComponent(nodeIdRaw)) : null;
    const isNodeScope = !!nodeId;
    const scope = isNodeScope ? "node" : "file";
    const cacheKey = isNodeScope ? `${fileKey}#${nodeId}` : `${fileKey}#__FILE__`;

    return {
      fileKey,
      nodeId,
      scope,
      cacheKey,
      normalizedUrl: isNodeScope
        ? `https://www.figma.com/file/${fileKey}/?node-id=${encodeURIComponent(nodeId)}`
        : `https://www.figma.com/file/${fileKey}/`,
      originalUrl: inputUrl,
      normalizationVersion: NORMALIZATION_VERSION,
    };
  }

  function buildPaths(normalized, extra) {
    if (normalized.scope === "file") {
      return {
        meta: `${CACHE_BASE_FOR_STORAGE}/files/${normalized.fileKey}/meta.json`,
        spec: `${CACHE_BASE_FOR_STORAGE}/files/${normalized.fileKey}/spec.md`,
        stateMap: `${CACHE_BASE_FOR_STORAGE}/files/${normalized.fileKey}/state-map.md`,
        raw: `${CACHE_BASE_FOR_STORAGE}/files/${normalized.fileKey}/raw.json`,
      };
    }

    const safeNode = sanitizeNodeId(normalized.nodeId);
    const segmentRaw = extra && extra.nodeSegment ? String(extra.nodeSegment).trim() : "";
    const segment = segmentRaw
      ? segmentRaw
          .replace(/^\/+|\/+$/g, "")
          .split("/")
          .filter((p) => p && p !== "." && p !== "..")
          .join("/")
      : "";
    const nodeBase = segment
      ? `${CACHE_BASE_FOR_STORAGE}/files/${normalized.fileKey}/nodes/${segment}/${safeNode}`
      : `${CACHE_BASE_FOR_STORAGE}/files/${normalized.fileKey}/nodes/${safeNode}`;
    return {
      meta: `${nodeBase}/meta.json`,
      spec: `${nodeBase}/spec.md`,
      stateMap: `${nodeBase}/state-map.md`,
      raw: `${nodeBase}/raw.json`,
    };
  }

  function buildUpsertItem(normalized, oldItem, extra, syncedAt) {
    const mergedUrls = Array.from(
      new Set([...(oldItem ? oldItem.originalUrls || [] : []), normalized.originalUrl])
    );
    return {
      fileKey: normalized.fileKey,
      nodeId: normalized.nodeId,
      scope: normalized.scope,
      url: normalized.normalizedUrl,
      originalUrls: mergedUrls,
      normalizationVersion: NORMALIZATION_VERSION,
      paths:
        extra && extra.nodeSegment && (!oldItem || extra.forceNodeSegment)
          ? buildPaths(normalized, extra)
          : oldItem && oldItem.paths
            ? oldItem.paths
            : buildPaths(normalized, extra),
      syncedAt,
      completeness: resolveCompleteness(extra, oldItem),
      source: (extra && extra.source) || (oldItem && oldItem.source) || "manual",
    };
  }

  function previewUpsertByUrl(inputUrl, extra) {
    const normalized = normalizeFigmaUrl(inputUrl);
    const index = normalizeIndexShape(readIndex());
    const oldItem = getItem(index, normalized.cacheKey);
    const item = buildUpsertItem(normalized, oldItem, extra, new Date().toISOString());
    return { normalized, item };
  }

  function upsertByUrl(inputUrl, extra) {
    const normalized = normalizeFigmaUrl(inputUrl);
    const index = normalizeIndexShape(readIndex());
    const oldItem = getItem(index, normalized.cacheKey);
    const item = buildUpsertItem(normalized, oldItem, extra, new Date().toISOString());

    index.items = index.items || {};
    index.items[normalized.cacheKey] = item;
    writeIndex(index);
    return { normalized, item };
  }

  return {
    normalizeFigmaUrl,
    previewUpsertByUrl,
    upsertByUrl,
  };
}

module.exports = {
  createUpsertService,
};