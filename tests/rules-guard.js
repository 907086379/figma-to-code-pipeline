"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function mustContainAll(relPath, requiredSnippets) {
  const text = read(relPath);
  requiredSnippets.forEach((snippet) => {
    assert.ok(
      text.includes(snippet),
      `${relPath} is missing required semantic snippet: ${snippet}`
    );
  });
}

// Rule 00: low-token baseline must keep key output constraints.
mustContainAll("cursor-bootstrap/rules/00-output-token-budget.mdc", [
  "结果优先",
  "原文最小化",
  "文件优先",
  "进度最小化",
  "失败原因 / 定位信息 / 修复动作",
  "cursor-bootstrap",
  ".cursor",
  "verify:cursor:sync",
]);

// Rule 01: core cache workflow and hard gates must remain.
mustContainAll("cursor-bootstrap/rules/07-karpathy-coding-discipline.mdc", [
  "先想清楚再写",
  "最小够用实现",
  "手术式改动",
  "目标可验证",
  "pnpm test",
  "fc:validate",
]);

mustContainAll("cursor-bootstrap/rules/01-figma-cache-core.mdc", [
  "标准化链接并读取 `figma-cache/index.json`",
  "命中且字段足够：只读本地，不调 MCP",
  "get_design_context",
  "get_metadata",
  "get_variable_defs",
  "mcp-raw-manifest.json",
  "fileHashes/fileSizes/toolCalls",
  "反精简检查",
  "upsert/ensure",
  "validate",
  "layout,text,tokens,interactions,states,accessibility",
  "flow",
  "🔄 Figma 缓存状态",
]);

// Skill: keep as concise execution checklist, while preserving key behavior.
mustContainAll("cursor-bootstrap/skills/figma-mcp-local-cache/SKILL.md", [
  "执行清单",
  "fc:get",
  "get_design_context",
  "get_metadata",
  "get_variable_defs",
  "mcp-raw-manifest.json",
  "anti-truncation",
  "validate",
  "🔄 Figma 缓存状态",
  "禁止贴 MCP 原文",
]);

console.log("rules-guard: ok");
