"use strict";

const fs = require("fs");
const path = require("path");

/**
 * @param {string} nodeId
 * @returns {string}
 */
function sanitizeNodeId(nodeId) {
  return String(nodeId).replace(/:/g, "-");
}

/**
 * @param {string} nodeId
 * @returns {string}
 */
function normalizeNodeIdColon(nodeId) {
  const raw = String(nodeId).trim();
  return /^(\d+)-(\d+)$/.test(raw) ? raw.replace(/^(\d+)-(\d+)$/, "$1:$2") : raw;
}

/**
 * @param {string} url
 * @returns {{ fileKey: string, nodeIdColon: string }}
 */
function parseCacheKeyFromUrl(url) {
  const u = new URL(url);
  const m = u.pathname.match(/\/(file|design)\/([^/]+)/i);
  const fileKey = m ? m[2] : "";
  const nodeRaw = u.searchParams.get("node-id") || "";
  const nodeColon = nodeRaw.replace(/-/g, ":");
  return { fileKey, nodeIdColon: nodeColon };
}

/**
 * Trim leading/trailing slashes; reject path traversal segments.
 * @param {string} segment
 * @returns {string}
 */
function normalizeNodeSegment(segment) {
  const raw = String(segment || "").trim().replace(/^\/+|\/+$/g, "");
  if (!raw) {
    throw new Error("nodeSegment must be a non-empty path segment");
  }
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) {
    throw new Error("nodeSegment must be a non-empty path segment");
  }
  for (const part of parts) {
    if (part === ".." || part === ".") {
      throw new Error(`nodeSegment contains forbidden segment: ${part}`);
    }
  }
  return parts.join("/");
}

/**
 * @param {string} cacheDirAbs
 * @param {string} maybeAbsOrRel
 * @returns {string|null}
 */
function dirnameRelFromMetaPath(cacheDirAbs, maybeAbsOrRel) {
  const raw = String(maybeAbsOrRel || "").trim();
  if (!raw) {
    return null;
  }
  const metaAbs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cacheDirAbs, raw);
  const nodeDirAbs = path.dirname(metaAbs);
  const rel = path.relative(cacheDirAbs, nodeDirAbs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return rel.split(path.sep).join("/");
}

/**
 * @param {object} params
 * @param {string} params.fileKey
 * @param {string} params.nodeId
 * @param {string} [params.nodeSegment]
 * @param {string} params.cacheDirAbs
 * @param {string} [params.indexJsonPath]
 * @returns {string} path relative to cache root, e.g. files/<fileKey>/nodes/sip/3710-5718
 */
function resolveNodeDirRel({ fileKey, nodeId, nodeSegment, cacheDirAbs, indexJsonPath }) {
  const safeNode = sanitizeNodeId(nodeId);
  const fk = String(fileKey || "").trim();
  if (!fk) {
    throw new Error("fileKey is required");
  }
  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  if (nodeSegment) {
    const seg = normalizeNodeSegment(nodeSegment);
    return `files/${fk}/nodes/${seg}/${safeNode}`;
  }

  const indexPath =
    indexJsonPath && String(indexJsonPath).trim()
      ? path.isAbsolute(indexJsonPath)
        ? path.normalize(indexJsonPath)
        : path.resolve(cacheDirAbs, indexJsonPath)
      : path.join(cacheDirAbs, "index.json");

  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const nodeColon = String(nodeId).trim().replace(/^(\d+)-(\d+)$/, "$1:$2");
      const cacheKey = `${fk}#${nodeColon}`;
      const item = (index.items && index.items[cacheKey]) || null;
      if (item && item.paths && item.paths.meta) {
        const rel = dirnameRelFromMetaPath(cacheDirAbs, item.paths.meta);
        if (rel) {
          return rel;
        }
      }
    } catch {
      /* fall through to default */
    }
  }

  return `files/${fk}/nodes/${safeNode}`;
}

/**
 * @param {object} params
 * @returns {string}
 */
function resolveNodeDirAbs(params) {
  const rel = resolveNodeDirRel(params);
  return path.join(params.cacheDirAbs, ...rel.split("/"));
}

module.exports = {
  sanitizeNodeId,
  normalizeNodeIdColon,
  parseCacheKeyFromUrl,
  normalizeNodeSegment,
  resolveNodeDirRel,
  resolveNodeDirAbs,
};
