/* eslint-disable no-console */
"use strict";

/**
 * figma-e2e-batch.json v2 读取与归一化（工具链唯一入口）。
 *
 * v2 顶层结构：
 * { version: 2, cases: [ { id?, designRef, target, mount?, audit?, limits?, policy?, constraints? } ] }
 *
 * 约束：
 * - 破坏性升级：不兼容旧格式
 * - 所有路径（target.entry / mount.mountPage）默认按“项目根目录相对路径”理解
 *
 * cases[].constraints（可选）：
 * - 由 `forbidden-markup-check.cjs` 读取，与 `ui-hard-constraints` 基线及 policy 编译结果做 **并集**（追加禁止项），
 *   不会用空字段“擦掉”基线；`forbiddenPatterns[].vueSlice: "template"` 时仅作用于 Vue `<template>`。
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_LIMITS = {
  minScore: 85,
  maxWarnings: 10,
  maxDiffs: 10,
};

function normalizeNodeIdToCache(nodeId) {
  const v = String(nodeId || "").trim();
  if (!v) return "";
  return v.includes(":") ? v : v.replace(/-/g, ":");
}

function normalizeNodeIdToBatch(nodeId) {
  const v = String(nodeId || "").trim();
  if (!v) return "";
  return v.includes("-") ? v : v.replace(/:/g, "-");
}

function cacheKeyFromDesignRef(designRef) {
  const fileKey = String(designRef && designRef.fileKey ? designRef.fileKey : "").trim();
  const nodeId = String(designRef && designRef.nodeId ? designRef.nodeId : "").trim();
  if (!fileKey || !nodeId) return "";
  return `${fileKey}#${normalizeNodeIdToCache(nodeId)}`;
}

function readJsonOrThrow(absPath, label) {
  const text = fs.readFileSync(absPath, "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e && e.message ? e.message : "unknown json parse error";
    throw new Error(`${label || "json"} 解析失败：${absPath} (${msg})`);
  }
}

function ensureBatchV2Shape(payload, batchAbs) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`[ui-batch-v2] batch 必须是对象：{ version:2, cases:[...] }。实际：${batchAbs}`);
  }
  const version = Number(payload.version);
  if (version !== 2) {
    throw new Error(`[ui-batch-v2] batch.version 必须为 2。实际：${JSON.stringify(payload.version)} (${batchAbs})`);
  }
  if (!Array.isArray(payload.cases) || payload.cases.length === 0) {
    throw new Error(`[ui-batch-v2] batch.cases 必须是非空数组：${batchAbs}`);
  }
  return payload;
}

function resolveAbsFromProjectRoot(projectRootAbs, maybeRel) {
  const trimmed = String(maybeRel || "").trim();
  if (!trimmed) return "";
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.join(projectRootAbs, trimmed);
}

function normalizeCase(raw, index) {
  const id = String(raw && raw.id ? raw.id : "").trim() || `case-${index}`;
  const designRefRaw = raw && raw.designRef && typeof raw.designRef === "object" ? raw.designRef : null;
  const designRef = designRefRaw
    ? {
        fileKey: String(designRefRaw.fileKey || "").trim(),
        nodeId: normalizeNodeIdToBatch(String(designRefRaw.nodeId || "").trim()),
      }
    : { fileKey: "", nodeId: "" };

  const targetRaw = raw && raw.target && typeof raw.target === "object" ? raw.target : null;
  const target = targetRaw
    ? {
        kind: String(targetRaw.kind || "").trim(),
        entry: String(targetRaw.entry || "").trim(),
        assets: Array.isArray(targetRaw.assets) ? targetRaw.assets.map((x) => String(x || "").trim()).filter(Boolean) : [],
      }
    : { kind: "", entry: "", assets: [] };

  const mountRaw = raw && raw.mount && typeof raw.mount === "object" ? raw.mount : null;
  const mount = mountRaw
    ? {
        mountPage: String(mountRaw.mountPage || "").trim(),
        mode: String(mountRaw.mode || "").trim() || "inject",
        marker: String(mountRaw.marker || "").trim() || `case-${index}`,
      }
    : null;

  const auditRaw = raw && raw.audit && typeof raw.audit === "object" ? raw.audit : null;
  const auditModeDefault = target.kind === "html" ? "html-partial" : "web-strict";
  const audit = auditRaw
    ? {
        mode: String(auditRaw.mode || "").trim() || auditModeDefault,
        dimensions: Array.isArray(auditRaw.dimensions)
          ? auditRaw.dimensions.map((x) => String(x || "").trim()).filter(Boolean)
          : [],
      }
    : { mode: auditModeDefault, dimensions: [] };

  const limitsRaw = raw && raw.limits && typeof raw.limits === "object" ? raw.limits : null;
  const limits = {
    minScore: Number.isFinite(Number(limitsRaw && limitsRaw.minScore)) ? Number(limitsRaw.minScore) : DEFAULT_LIMITS.minScore,
    maxWarnings: Number.isFinite(Number(limitsRaw && limitsRaw.maxWarnings))
      ? Number(limitsRaw.maxWarnings)
      : DEFAULT_LIMITS.maxWarnings,
    maxDiffs: Number.isFinite(Number(limitsRaw && limitsRaw.maxDiffs)) ? Number(limitsRaw.maxDiffs) : DEFAULT_LIMITS.maxDiffs,
  };

  const policy = raw && raw.policy && typeof raw.policy === "object" ? raw.policy : null;
  const constraints = raw && raw.constraints && typeof raw.constraints === "object" ? raw.constraints : null;

  const cacheKey = cacheKeyFromDesignRef(designRef);

  return {
    index,
    id,
    designRef,
    cacheKey,
    target,
    mount,
    audit,
    limits,
    policy,
    constraints,
    _raw: raw,
  };
}

function validateNormalizedCase(item, batchAbs) {
  const at = `[ui-batch-v2] case[${item.index}]`;
  if (!item.designRef.fileKey || !item.designRef.nodeId) {
    throw new Error(`${at} designRef 缺失 fileKey/nodeId（${batchAbs}）`);
  }
  if (!item.target.kind || !["vue", "react", "html"].includes(item.target.kind)) {
    throw new Error(`${at} target.kind 必须为 vue/react/html。实际：${JSON.stringify(item.target.kind)}（${batchAbs}）`);
  }
  if (!item.target.entry) {
    throw new Error(`${at} target.entry 不能为空（${batchAbs}）`);
  }
  if (!item.cacheKey) {
    throw new Error(`${at} cacheKey 计算失败（请检查 designRef）（${batchAbs}）`);
  }
  if (item.mount) {
    if (!item.mount.mountPage) {
      throw new Error(`${at} mount.mountPage 不能为空（${batchAbs}）`);
    }
    const mode = String(item.mount.mode || "").trim();
    if (!["inject", "iframe", "manual"].includes(mode)) {
      throw new Error(`${at} mount.mode 仅支持 inject/iframe/manual。实际：${JSON.stringify(mode)}（${batchAbs}）`);
    }
  }
  if (item.audit) {
    const mode = String(item.audit.mode || "").trim();
    if (!["web-strict", "html-partial"].includes(mode)) {
      throw new Error(`${at} audit.mode 仅支持 web-strict/html-partial。实际：${JSON.stringify(mode)}（${batchAbs}）`);
    }
  }
}

function readBatchV2(batchAbs, projectRootAbs) {
  const abs = path.isAbsolute(batchAbs) ? path.normalize(batchAbs) : path.join(projectRootAbs, batchAbs);
  if (!fs.existsSync(abs)) {
    throw new Error(`[ui-batch-v2] batch 文件不存在：${abs}`);
  }
  const payload = ensureBatchV2Shape(readJsonOrThrow(abs, "batch"), abs);
  const normalized = payload.cases.map((raw, i) => normalizeCase(raw, i));
  normalized.forEach((item) => validateNormalizedCase(item, abs));
  return {
    abs,
    version: 2,
    cases: normalized,
    projectRootAbs,
  };
}

function writeBatchV2(batchAbs, projectRootAbs, value) {
  const abs = path.isAbsolute(batchAbs) ? path.normalize(batchAbs) : path.join(projectRootAbs, batchAbs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return abs;
}

module.exports = {
  DEFAULT_LIMITS,
  normalizeNodeIdToCache,
  normalizeNodeIdToBatch,
  cacheKeyFromDesignRef,
  resolveAbsFromProjectRoot,
  readBatchV2,
  writeBatchV2,
};

