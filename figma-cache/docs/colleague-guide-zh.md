# figma-to-code-pipeline：团队说明（可转发）

**主文档（权威）**：`figma-cache/docs/README.md` —— 含 **一页速查**（协作口径、ingest 示例、主提示词全文）与 **命令 / 环境变量 / UI / flow** 全集。

本文件面向 IM / Wiki **转发**：只保留 **术语表**、**首次接入四步**、**升级与提交建议**，避免与主文档重复维护。

---

## 0. 三句话先记住

1. **缓存优先**：同一节点已有可用缓存时，不重复拉 MCP。
2. **证据优先**：来源为 `figma-mcp` 时，节点目录必须有 `mcp-raw/` 与 manifest；落盘优先 **`npm run fc:mcp:ingest:quiet`**（等价 `fc:mcp:ingest -- --quiet`），勿在长对话里手写四文件与哈希。
3. **校验闭环**：`fc:mcp:ingest` 已含 `validate` 与 `budget`；**不要**默认再跑 `fc:mcp:gate`（仅手工改盘、未跑 ingest 时修补用）。

---

## 1. 核心术语速查

| 名词 | 一句话解释 |
|------|------------|
| `index.json` | 缓存总索引，包含 `items`（节点）与 `flows`（流程关系）。 |
| `item` | 一个缓存节点记录，键是 `cacheKey`，值包含 `url`、`paths`、`completeness` 等。 |
| `cacheKey` | 标准唯一键，通常是 `fileKey#nodeId`（无 node 时 `fileKey#__FILE__`）。 |
| `ensure` | 负责索引与骨架文件，不是 MCP 拉取器。 |
| `upsert` | 更新或写入缓存记录，常与 MCP 拉取后的落盘联用。 |
| `validate` | 校验索引结构、证据完整性、流程引用关系。 |
| `completeness` | 这次希望覆盖的维度集合（如 `layout,text,tokens,...`）。 |
| `mcp-raw/` | MCP 原始回包目录，作为「来源为 figma-mcp」的审计证据。 |
| `fc:mcp:ingest` | 默认落盘命令：三段回包 → `mcp-raw/` + manifest → `fc:ensure` → `fc:validate` → **`fc:budget --mcp-only`**；加 **`--enrich`** 刷新当前节点派生物。 |
| `fc:mcp:gate` | 修补用：未跑 ingest、仅改磁盘证据时全量 `validate` + `budget`；`--enrich` 为 `enrich --all`。 |
| `tokenProxyBytes` | 基于 `mcp-raw-get-design-context.txt` 文件大小的 token 代理指标。 |
| `data-annotations` | 设计说明可出现在 MCP 生成代码的标签属性中；`fc:ensure` 会汇总到 `spec.md`「Annotations」与 `raw.json.figmaDataAnnotations`。 |
| `flow` | 业务流程关系（多屏顺序/分支），维护在 `index.json.flows`。 |
| URL 中的 `&`（Windows） | `fc:mcp:ingest` 会尝试自动拼回被 cmd 拆开的查询段；备选见主文档 **「Windows / shell：`--url` 中的 `&`」** 与 **`FIGMA_MCP_INGEST_URL`**。 |

---

## 2. 一次性接入（仅首次）

1. `npm i -D figma-to-code-pipeline`
2. `npx figma-cache cursor init`（刷新 `.cursor/`、`figma-cache.config.js`、根目录 `AGENT-SETUP-PROMPT.md`、本文件）
3. 在 Cursor 中 **`@AGENT-SETUP-PROMPT.md`** 让 Agent 完成栈 Adapter 与 `fc:*` scripts（通常一次即可）
4. `npm run fc:init`（无 script 时用 `npx figma-cache init`）→ 生成 `figma-cache/index.json`

> `cursor init` 管模板与任务书；`figma-cache init` 管本地数据骨架。

---

## 3. 日常协作（摘要）

- **同事**：Figma 链接 + 任务目标；前后页/分支/跳转写在同一条需求里；要最新稿写「强制刷新」。
- **Agent / 脚本**：缓存优先 → 按需 MCP → **`npm run fc:mcp:ingest:quiet`**；完整链路与主提示词见 **主文档「一页速查」**。
- **Windows + 含 `&` 的链接**：`fc:mcp:ingest` 会**自动拼接**被 cmd 拆开的 `key=value` 查询段到 `--url`；仍失败可用 **`--url-file`** / **`FIGMA_MCP_INGEST_URL`** / **`--file-key`+`--node-id`**。详见主文档 **「Windows / shell：`--url` 中的 `&`」**。

---

## 4. 升级包后

```bash
npm i -D figma-to-code-pipeline@latest
npx figma-cache cursor init
```

`cursor init` 会刷新任务书与本摘要；已有 `index.json` 时一般不必重复 `fc:init`。

---

## 5. 提交与协作建议

- 建议纳入版本库：`.cursor/`、`figma-cache.config.js`、`AGENT-SETUP-PROMPT.md`、`package.json` / lock。
- 业务仓库可自行约定是否跟踪 `figma-cache/index.json` 与 `figma-cache/files/`；本工具链仓库 `.gitignore` 默认**忽略** `figma-cache/files/` 与 `figma-cache/mobile-specs/`（仅保留空索引与脚本/docs 入库）。
- 流程总览类文档可由 `postEnsure` 维护 `docs/figma-flow-readme.md`（或 `FIGMA_CACHE_FLOW_README`）。

---

## 6. 文档入口

| 用途 | 路径 |
|------|------|
| 主手册（一页速查 + 命令全集） | `figma-cache/docs/README.md` |
| 本文件（术语 + 接入 + 转发摘要） | `figma-cache/docs/colleague-guide-zh.md` |
| 兼容旧书签 | `figma-cache/docs/quick-start-zh.md` → 指向主文档 |

克隆工具链源码仓库的治理类说明见仓库根 **`docs/README.md`**。
