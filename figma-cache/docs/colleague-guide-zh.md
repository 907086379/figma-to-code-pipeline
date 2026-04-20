# figma-to-code-pipeline：团队使用说明（可转发）

本文面向业务仓库里需要使用 Figma 本地缓存的同事，目标是统一最新协作流程：
- 先读本地缓存，命中即复用；
- 仅在缺口或明确刷新时调用 Figma MCP；
- MCP 原始证据先落盘，再执行 `upsert/ensure`；
- 同轮完成 `validate`，未通过不算完成。

---

## 0. 三句话先记住

1. **缓存优先**：同一节点已有可用缓存时，不重复拉 MCP。
2. **证据优先**：当来源是 `figma-mcp`，节点目录必须有 `mcp-raw/` 证据文件，不能只写骨架假成功。
3. **校验闭环**：执行 `upsert/ensure` 后必须通过 `fc:validate`，否则不能宣称“缓存已就绪”。

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
| `mcp-raw/` | MCP 原始回包目录，作为“来源为 figma-mcp”的审计证据。 |
| `tokenProxyBytes` | 基于 `mcp-raw-get-design-context.txt` 文件大小的 token 代理指标。 |
| `flow` | 业务流程关系（多屏顺序/分支），维护在 `index.json.flows`。 |

---

## 2. 一次性接入（仅首次）

按固定顺序执行，避免混淆：

### 步骤 1：安装

```bash
npm i -D figma-to-code-pipeline
```

### 步骤 2：初始化 Cursor 模板

```bash
npx figma-cache cursor init
```

这一步会刷新：
- `.cursor/rules/` 与 `.cursor/skills/`（按安全策略写入/跳过）
- `figma-cache.config.js`
- 根目录 `AGENT-SETUP-PROMPT.md`
- `figma-cache/docs/colleague-guide-zh.md`

### 步骤 3：在 Cursor 中执行任务书

在对话中 `@AGENT-SETUP-PROMPT.md` 并要求 Agent 按文档执行。通常只需成功一次，用于补齐栈适配规则与 `fc:*` scripts。

### 步骤 4：初始化缓存索引

```bash
npm run fc:init
```

若尚未配置 scripts：

```bash
npx figma-cache init
```

> `cursor init` 负责模板与任务书；`figma-cache init` 负责本地数据骨架（`figma-cache/index.json`）。

---

## 3. 日常协作流程（最新口径）

### 3.1 同事侧只需要做什么

- 把 Figma 链接 + 任务目标发给 Agent。
- 若有关系语义（前后页、分支、跳转），在同一条需求里说清楚。
- 需要最新稿时明确写“强制刷新”。

### 3.2 Agent 侧标准执行链

1. 标准化链接并查本地缓存。
2. 命中且字段足够：直接复用，不调 MCP。
3. 未命中/字段不足/用户要求刷新：按最小调用集调 MCP，原始回包写入 `mcp-raw/`。
4. 执行 `upsert/ensure` 写索引与缓存文件。
5. 同轮执行 `fc:validate`，直到通过。

### 3.3 本轮交付最小回报项（建议）

- 缓存状态：命中 / 缺失 / 更新
- 来源：Local / MCP
- 关键输出文件清单
- MCP 调用次数与是否触发 flow 自动追加（若触发，注明原因）

---

## 4. completeness、flow 与预算策略

### 4.1 默认 completeness

默认值：`layout,text,tokens,interactions,states,accessibility`。

### 4.2 flow 自动追加（白名单）

仅在以下场景自动追加 `flow`：
- 关系关键词命中：`关联`、`流程`、`跳转`、`前后页`、`上一步`、`下一步`、`分支`、`链路`、`路径`、`from/to`、`next`、`branch`
- 同轮或断续出现多条 Figma 链接，且明确有串联意图（如 A -> B）

不会自动追加 `flow` 的场景：
- 单链接且无关系意图
- 仅视觉微调/文案修改
- 仅资产导出

### 4.3 严格证据与骨架模式

- `source=figma-mcp` 时，`upsert/ensure` 默认需要通过 MCP 证据门禁。
- 仅当你明确知道在做“先落骨架”时，才临时使用 `--allow-skeleton-with-figma-mcp`。
- 即使允许骨架写入，后续 `validate` 仍必须通过，才能视为完成。

### 4.4 预算字段

- 建议统一看 `tokenProxyBytes`。
- `tokenProxyChars` 为兼容字段，仅用于平滑迁移。

---

## 5. 团队主提示词（保留一个模板）

### 5.1 默认主提示词

```text
请按项目 figma 缓存规则处理下面这条（或多条）Figma 链接，并遵循“缓存优先 + 按需 MCP + 最小调用集 + 校验闭环”：
1) 先查本地 figma-cache，命中且字段足够则直接复用，不刷新；
2) 仅在未命中、字段不足或我明确要求刷新时，调用 figma-mcp；
3) MCP 原始数据写入节点目录 mcp-raw/ 后，再执行 upsert/ensure；
4) completeness 默认 layout,text,tokens,interactions,states,accessibility；仅命中 flow 白名单时自动补 flow；
5) 完成后执行 fc:validate，并汇报缓存状态、来源、MCP 调用次数、输出文件清单；若自动补 flow，说明触发原因。

[Figma 链接]
```

### 5.2 可选附加句（按需加一句）

- 强制最新：`忽略本地缓存，强制刷新，以 Figma 最新为准。`
- 补流程关系：`请在 flow [flowId] 下补齐节点关系（link/chain），并输出 mermaid。`
- 资产留档：`本次需要 assets 维度，请补全资产相关证据。`

---

## 6. 常用命令（排障/复核用）

```bash
npm run fc:config
npm run fc:get -- "<figma-url>"
npm run fc:ensure -- "<figma-url>" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility
npm run fc:upsert -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility
npm run fc:validate
npm run fc:budget
npm run fc:flow:show -- --flow=<flowId>
npm run fc:flow:mermaid -- --flow=<flowId>
```

---

## 7. 提交与协作建议

- 建议提交：`.cursor/`、`figma-cache.config.js`、`AGENT-SETUP-PROMPT.md`、`package.json`/lock。
- `figma-cache/index.json` 与 `figma-cache/files/` 是否入库，由团队统一约定。
- 若使用流程文档，建议同步维护 `docs/figma-flow-readme.md`（或 `FIGMA_CACHE_FLOW_README` 指定路径）。
- 若你**克隆工具链源码仓库**（而非仅从 npm 使用包），可阅读仓库根目录 **`docs/README.md`**：人读总览（当前工作流、`figma-flow-readme` 与 postEnsure 分工、Cursor 托管/本地治理、移动端规格可选流程）。

---

## 8. 升级包后的动作

```bash
npm i -D figma-to-code-pipeline@latest
npx figma-cache cursor init
```

说明：
- `cursor init` 每次会刷新任务书与本同事指南。
- 仅升级包通常不需要重复完整接入流程。
- 已有 `figma-cache/index.json` 时，一般不需要重复 `fc:init`。

---

## 9. 文档入口

- 业务仓库推荐入口：`figma-cache/docs/colleague-guide-zh.md`
- 包内完整文档：`node_modules/figma-to-code-pipeline/figma-cache/docs/README.md`
- 规范文档：`link-normalization-spec.md`、`flow-edge-taxonomy.md`

将本文件转发到团队 IM / Wiki 即可作为统一口径使用。