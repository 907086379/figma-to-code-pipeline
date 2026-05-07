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
4. **默认用脚本落盘（强制）**：拿到三段回包后 **只执行 `npm run fc:mcp:ingest:quiet`**（或 **`npm run fc:mcp:ingest -- ... --quiet`** / 项目已配置的等价 script；成功路径必 **quiet** 以减少终端与对话复盘体积；参数见 `figma-cache/docs/README.md` **「一页速查」**），一次性完成 `mcp-raw/*`、`mcp-raw-manifest.json`、`fc:ensure`、`fc:validate`、`fc:budget --mcp-only`；需要刷新派生物时对同一命令追加 **`--enrich`**。**禁止**再让用户加一句「跑 gate」类提示词。**禁止**默认在长对话里手写四个文件与哈希；**禁止**为落盘拆多段 `Write` staging 文件刷屏——优先 **`--stdin`** JSON 或本机终端一次性喂文件。
5. 若 ingest 未跑或手工补盘：立即做反精简检查（截断标记 + hash/size）并确保 manifest 与文件一致。
6. 若未通过 ingest 完成闭环：手动补跑 `fc:ensure --source=figma-mcp` / `fc:validate`，或 **`fc:mcp:gate`**（仅修补磁盘、未走 ingest 时的全量复核；与 ingest 不要重复执行）。

## 关键约束
- 禁止同参数重复调用 MCP。
- **`fc:mcp:ingest` 为 MCP 落盘默认路径**；与「手写 mcp-raw」二选一且以前者为默认。
- `flow` 非默认维度，仅白名单触发时追加，并在回复说明原因。
- 缓存任务默认不写业务 UI 代码。

## 用户可见输出（最小化）
- 首行固定：
  - `> 🔄 Figma 缓存状态: [命中|缺失|更新] | 来源: [Local|MCP] | 节点: {nodeId}`
- 仅补充：`mcp-raw anti-truncation`、MCP 调用统计、最终 completeness、文件清单、**ingest 退出码（0 表示 ensure + validate + budget 已串联）**。
- 除非用户明确要求，禁止贴 MCP 原文与长日志。

## 模板维护约定（强制）
- `cursor-bootstrap` 是 Skill 唯一手写来源。
- 仓库内 `.cursor/skills/*` 为镜像产物，使用 `npm run verify:cursor:sync` 同步生成。
