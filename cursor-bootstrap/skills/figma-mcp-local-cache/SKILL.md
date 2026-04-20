---
name: figma-mcp-local-cache
description: 将 Figma 链接信息沉淀到项目本地缓存并执行缓存优先读取。用于用户提供 Figma 链接、需要减少重复 MCP 调用、或要求复用历史规格文档的场景。
---

# Figma MCP Local Cache

本 Skill 仅定义“执行次序与最小输出”。权威约束以 `.cursor/rules/01-figma-cache-core.mdc` 为准；若冲突，以规则文件为准。

## 触发
- 用户消息包含 Figma URL、`fileKey+nodeId`、或“figma 缓存/本地缓存/刷新”语义时触发。

## 执行清单（按序）
1. 标准化链接，先查 `figma-cache/index.json`（`fc:get`）。
2. 命中且字段足够：复用本地缓存，结束。
3. 未命中/不足：仅调最小 MCP 集（默认）：
   - `get_design_context`（`excludeScreenshot=true`）
   - `get_metadata`
   - `get_variable_defs`
4. 原始回包写入 `mcp-raw/`，并写 `mcp-raw-manifest.json`（必须含 `files/fileHashes/fileSizes/toolCalls`）。
5. 立即执行反精简检查（截断标记 + hash/size）并记录结果。
6. 执行 `upsert/ensure` 后自动执行 `validate`；失败时自修复并循环到通过。

## 关键约束
- 禁止同参数重复调用 MCP。
- `flow` 非默认维度，仅白名单触发时追加，并在回复说明原因。
- 缓存任务默认不写业务 UI 代码。

## 用户可见输出（最小化）
- 首行固定：
  - `> 🔄 Figma 缓存状态: [命中|缺失|更新] | 来源: [Local|MCP] | 节点: {nodeId}`
- 仅补充：`mcp-raw anti-truncation`、MCP 调用统计、最终 completeness、文件清单、validate 结果。
- 除非用户明确要求，禁止贴 MCP 原文与长日志。

## 模板维护约定（强制）
- `cursor-bootstrap` 是 Skill 唯一手写来源。
- 仓库内 `.cursor/skills/*` 为镜像产物，使用 `npm run verify:cursor:sync` 同步生成。
