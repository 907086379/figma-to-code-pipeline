---
name: figma-mcp-local-cache
description: 将 Figma 链接信息沉淀到项目本地缓存并执行缓存优先读取。用于用户提供 Figma 链接、需要减少重复 MCP 调用、或要求复用历史规格文档的场景。
---

# Figma MCP Local Cache

本 Skill 与仓库规则 **`.cursor/rules/01-figma-cache-core.mdc`** **对齐**（表现层见栈占位 `02-figma-stack-adapter.mdc` 或你项目内的 `02-figma-<栈>-adapter.mdc`）：触发条件、闭环校验、回复开头 Blockquote **均为强制**。

<Trigger Conditions>

满足以下任一模式时，Agent **必须**进入本 Skill 的标准流程（标准化 → 读索引 → 本地或 MCP → 写回 → **upsert/ensure 后 validate**），并在用户可见回复**首段**输出规则所要求的缓存状态 Blockquote：

| 类型 | 用户原话 / 消息特征（示例模式，非穷举） |
| --- | --- |
| URL | 含 `https://www.figma.com/`、`http://figma.com/`、`figma.com/file/`、`figma.com/design/`、`figma.com/proto/`、`figma.com/embed` 等 |
| 参数 | 含 `node-id=`、`type=design` 等与 Figma 链接常见的查询串 |
| 键值 | 出现 `figma` 文件 key（约 22 字符）且同时出现 `node-id` /「节点」描述，意图为对齐某一节点 |
| 缓存词 | 「figma 缓存」「本地缓存」「先查缓存」「figma-cache」「index.json」「spec.md」「state-map」「命中/未命中」等且与具体设计任务绑定 |
| 落地词 | 「按 Figma 做」「还原设计稿」「对齐 Figma」「实现该节点」且上下文可解析出链接或 fileKey/node |
| 刷新词 | 「跳过缓存」「强制刷新」「以 Figma 最新为准」——走 MCP 与回写，状态标「更新」、来源 MCP |

未出现可解析链接/键/节点且纯概念讨论时，可不执行缓存流水线。

</Trigger Conditions>

## 适用场景
- 用户提供新的 Figma 链接并要求解析设计信息。
- 用户再次提供同一 Figma 文件或同一 node-id，期望复用历史结果。
- 用户明确要求「先查本地，不够再调 MCP」。

## 目录约定
- 缓存根目录（默认）：`figma-cache/`
- 索引文件（默认）：`figma-cache/index.json`
- 单链接缓存目录：`figma-cache/files/<fileKey>/nodes/<nodeId>/`
- 单链接缓存文件：
  - `meta.json`：基础元数据与来源信息
  - `spec.md`：可读规格摘要
  - `state-map.md`：状态与交互映射（如适用）
  - `raw.json`：必要的原始结构化数据摘录
- 可配置项：
  - `FIGMA_CACHE_DIR`：缓存根目录
  - `FIGMA_CACHE_INDEX_FILE`：索引文件名或绝对路径
  - `FIGMA_ITERATIONS_DIR`：历史回填目录
  - `FIGMA_CACHE_STALE_DAYS`：陈旧阈值（天）
  - `FIGMA_DEFAULT_FLOW`：默认 flowId（大迭代可减少重复 `--flow`）

## 流程关系（Flow）
- `figma-cache/index.json` 中的 `flows` 用于维护业务/交互流程的节点集合与边关系。
- 当用户描述「下一步/分支/同一流程」时，应同步更新对应 `flow` 的 `nodes/edges`。
- 默认 completeness 不含 `flow`；仅命中 flow 白名单时自动追加。
- flow 白名单：关系关键词（关联/流程/跳转/前后页/上一步/下一步/分支/链路/路径/from/to/next/branch），或同轮/断续多链接且明确串联意图。
- 不触发：单链接且无关系意图、仅视觉微调、仅资产导出。

## 标准流程
1. 按 `figma-cache/docs/link-normalization-spec.md` 标准化链接并生成键：
   - 节点级：`cacheKey = <fileKey>#<nodeId>`
   - 文件级（无 `node-id`）：`cacheKey = <fileKey>#__FILE__`
2. 读取 `index.json`：
   - 若命中且字段满足当前任务，直接读取本地缓存并继续实现。
   - 若未命中或信息不足，再调用 Figma MCP 拉取缺失数据。
3. 若需调用 MCP，默认按 **最小调用集**执行（同一 `fileKey + nodeId`）：
   - `get_design_context`（建议 `excludeScreenshot=true`）
   - `get_metadata`
   - `get_variable_defs`
4. **按需扩展调用**：
   - `get_screenshot` 仅在用户明确要求截图原始留档，或前三项不足以消除结构歧义时调用。
   - `whoami` 仅在鉴权/权限报错时调用；无报错时不调用。
5. **`get_design_context` 单轮硬约束**：同一 `fileKey + nodeId` 下，若已成功调用一次 `get_design_context`，除非参数发生变化（如 `forceCode`、`disableCodeConnect`、`excludeScreenshot`）或出现明确报错，否则禁止再次调用。
6. **按 completeness 的调用矩阵（强制）**：
   - `layout` → `get_metadata`（若结构层级不足，再补 `get_design_context`）
   - `text` → `get_design_context`
   - `tokens` → `get_variable_defs`
   - `interactions` / `flow` / `states` → `get_design_context`，并同步完善 `state-map.md` / `flows`
   - `accessibility`（若任务声明）→ 优先 `get_design_context` 语义线索，不足需显式标注缺口
   - `assets`（若任务声明）→ 使用 `get_design_context` 资产 URL；截图按需
7. **两阶段拉取**：先最小必要调用并检查字段缺口；仅在缺口存在时补调。
8. 同一参数的 MCP 工具在单轮内不得重复调用；若需落盘原始数据，必须优先复用首次响应。
9. **原始大文本直存策略**：当需保存 `mcp-raw-get-design-context.txt` 时，优先直接写入 `mcp-raw/` 子目录（不改写、不摘要、不二次解释），避免把整段文本再次喂给模型。
10. **本地分析优先**：若本地已存在可用 `mcp-raw-*` 与缓存加工文件，且用户未要求刷新/强制最新，后续分析默认只读本地文件，不再调用 Figma MCP。
11. 发生 MCP 拉取或本地补齐时，写入/更新 `meta.json`、`spec.md`、必要补充文件，并更新索引。
12. **`ensure` 语义边界（强制）**：`figma:cache:ensure` 仅补齐索引与骨架文件，不能替代 MCP 拉取；不得把“执行了 ensure”当成“完成了 figma-mcp 调用”。
13. **MCP 证据门禁（强制）**：当输出来源声明为 `figma-mcp` 时，节点目录必须存在 `mcp-raw/` 及最小调用集原始回包（按 completeness 裁剪）；若缺失，立即停止并报告“未完成”，不得宣称更新成功。
14. **调用预算**：单节点默认 MCP 调用不超过 3 次；超过时必须在回复中说明缺口字段与补调理由。
15. **重试策略**：仅对超时/5xx进行指数退避重试；参数错误/权限错误不重试并直接报告。
16. **大文件读取策略（强制）**：仅在“UI 还原/像素对齐/组件实现”任务时读取 `mcp-raw-get-design-context.txt` 全文；非 UI 实现任务（如命中检查、预算统计、校验、流程维护）默认只读 `raw.json`/`spec.md`/`mcp-raw-manifest.json`，避免无意义 token 消耗。
17. **闭环校验（强制）**：凡本轮执行了 **`npm run figma:cache:upsert`** 或 **`npm run figma:cache:ensure`**（任意参数组合），在命令成功结束后，Agent **必须**在同一仓库根目录**自动、静默**执行 `npm run figma:cache:validate`。
18. **校验失败**：根据脚本输出修复索引、`paths`、缺失文件、JSON 结构等，**循环执行 validate 直至退出码为 0**；不得在 validate 未通过时结束本轮「写缓存」任务。
19. 对用户反馈时除 Blockquote 外可补充：`source: local-cache` / `source: figma-mcp` 与简要文件列表（不必粘贴完整终端日志）。

## Agent 最终输出格式（强制）
- 触发 `<Trigger Conditions>` 且本轮触碰缓存读写的回复，**第一段**必须为单行 Blockquote：
  - `> 🔄 Figma 缓存状态: [命中|缺失|更新] | 来源: [Local|MCP] | 节点: {nodeId}`
- `nodeId` 与索引一致；文件级写 `__FILE__` 或与 `index.json` 相同的占位。
- Blockquote 之后接任务正文。

## 执行责任
- 默认由 agent 执行缓存查询、写入、**upsert/ensure 后的 validate**、失败自修复与回填，用户不需要手动执行命令。
- 仅当用户明确要求「我自己执行」或「请给我命令」时，才提供命令让用户手动运行。
- 在常规对话中，以「已自动完成」方式汇报，不要求用户额外操作。

## 索引建议结构
```json
{
  "schemaVersion": 2,
  "version": 1,
  "updatedAt": "2026-04-14T12:00:00Z",
  "flows": {
    "example-flow": {
      "id": "example-flow",
      "title": "Example",
      "nodes": ["xxxx#12:34"],
      "edges": [
        {
          "id": "edge-1",
          "from": "xxxx#12:34",
          "to": "xxxx#56:78",
          "type": "next_step",
          "note": "",
          "createdAt": "2026-04-14T12:00:00Z"
        }
      ],
      "assumptions": [],
      "openQuestions": []
    }
  },
  "items": {
    "fileKey#nodeId": {
      "fileKey": "xxxx",
      "nodeId": "12:34",
      "scope": "node",
      "url": "https://www.figma.com/file/xxxx?node-id=12%3A34",
      "originalUrls": [
        "https://www.figma.com/file/xxxx?node-id=12%3A34&t=abc",
        "https://www.figma.com/design/xxxx?node-id=12:34"
      ],
      "normalizationVersion": 1,
      "paths": {
        "meta": "figma-cache/files/xxxx/nodes/12-34/meta.json",
        "spec": "figma-cache/files/xxxx/nodes/12-34/spec.md",
        "stateMap": "figma-cache/files/xxxx/nodes/12-34/state-map.md",
        "raw": "figma-cache/files/xxxx/nodes/12-34/raw.json"
      },
      "syncedAt": "2026-04-14T12:00:00Z",
      "completeness": ["layout", "text", "tokens", "interactions", "states", "accessibility"]
    }
  }
}
```

## 刷新策略
- 用户说「强制刷新/以最新 Figma 为准」：直接走 MCP，并覆盖 `syncedAt` 与内容；Blockquote 标「更新」、来源 MCP。
- 仅缺某些字段：执行部分刷新，保留已有内容，更新 `completeness`。
- 若链接无 `node-id`，先缓存到文件级（`__FILE__`），再按后续 node 增量补充。
- 当 `syncedAt` 超过 14 天时，默认先提示用户是否刷新。
- 若需“保存 MCP 原始数据”，默认保存最小调用集三项原始回包；截图原始回包按需保存。
- 原始数据统一写到节点目录 `mcp-raw/` 子目录；加工缓存继续放在节点根目录（`meta.json` / `raw.json` / `spec.md` / `state-map.md`）。
- 默认不保存 `whoami` 原始文件；仅在鉴权排障或用户显式要求时保存。
- 对 `mcp-raw-get-design-context.txt` 优先采用“直存”方式（不二次改写正文），降低 token 消耗并保持可追溯性。
- `completeness` 建议至少按以下维度声明：`layout`、`text`、`tokens`、`interactions`、`flow`、`states`、`assets`、`accessibility`（按任务取子集）。
- `mcp-raw-manifest.json` 应包含审计字段：`callPolicy`（如 `minimum-set-v1`）、`dedupeApplied`（布尔）、`toolCalls`（每个工具的 `count` / `effectiveSaved`），便于后续统计与复盘。
- 折中推荐：在 `raw.json` 增加 `coverageSummary`（`covered` / `missing` / `evidence`）用于最小覆盖审计，不强制完整模板。

## 输出约束
- **必须先**输出规定的缓存状态 Blockquote，再给出设计结论或实现说明。
- 若跳过 MCP，Blockquote 中来源为 Local，状态多为「命中」。
- 若调用 MCP，Blockquote 中来源为 MCP，状态多为「缺失→更新」或「更新」，并在后文简述触发原因（未命中/信息不足/用户强刷）。

## 推荐命令（v2 流程）
- `npm run figma:cache:init`：初始化空索引（用于纯净移植）
- `npm run figma:cache:config`：查看当前生效配置
- `npm run figma:cache:get -- "<figma-url>"`：检查命中情况
- 先执行 MCP 最小调用集并写入 `mcp-raw/`，再执行：`npm run figma:cache:upsert -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`
- `npm run figma:cache:ensure -- "<figma-url>" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility`：自动补齐缓存骨架文件（非 MCP 拉取）
- 若命中 flow 白名单场景，自动或显式追加：`--completeness=layout,text,tokens,interactions,states,accessibility,flow`
- 一旦自动追加了 `flow`，对用户回复必须附带触发原因：`关键词命中` 或 `多链接串联意图`。
- MCP 默认最小调用集：`get_design_context(excludeScreenshot=true)` + `get_metadata` + `get_variable_defs`
- `npm run figma:cache:validate`：**每次 upsert/ensure 成功后必须自动执行**；失败则修至通过
- `npm run figma:cache:budget`：查看 MCP 节点预算汇总（默认 `--mcp-only`，按文件大小估算 token 代理）
- `npm run figma:cache:stale`：检查超 14 天的陈旧缓存
- `npm run figma:cache:backfill`：从历史迭代文档回填索引
- `npm run figma:cache:flow:init|add-node|link|chain|show|mermaid`：维护流程关系
