# Figma MCP → `fc:mcp:ingest:quiet` 子任务委派模板（仓库维护）

**用途**：发给 **`Task` / `generalPurpose` 子会话** 的正文骨架；占位符在派发前替换。与 `fc:mcp:ingest` 实现及 `01-figma-cache-core` 输出格式同步维护。

**占位符**

- `{{FIGMA_URL}}`：带 `node-id` 的 Figma 设计链接（或 `{{FILE_KEY}}` + `{{NODE_ID}}` 如 `9295:55633` / `9295-55633`）
- `{{PROJECT_ROOT}}`：本仓库根目录的绝对路径（子任务 `cwd`）
- `{{ENRICH}}`：需要刷新派生物时写「是，对本节点加 `--enrich`」；否则写「否」

---

在项目根 `{{PROJECT_ROOT}}` 完成 Figma 节点落盘与 ingest（父会话不执行本条）。

**参数（二选一）**

- URL：`{{FIGMA_URL}}`
- 或 `fileKey` + `nodeId`：`{{FILE_KEY}}` / `{{NODE_ID}}`

**流程**

1. 读 `figma-cache/index.json` 与 `figma-cache/files/<fileKey>/nodes/<nodeId-带横线>/`；若已有完整 `mcp-raw/mcp-raw-manifest.json` 且 `fc:validate` 可信则跳过 MCP；否则调用 Figma MCP：`get_design_context`（默认排除截图若工具支持）、`get_metadata`、`get_variable_defs`。
2. 三段回包经 **`npm run fc:mcp:ingest:quiet`**（或 `pnpm` / `node scripts/workflow/mcp-raw-ingest.cjs ... --quiet`）落盘；按需 **`{{ENRICH}}`**。**禁止**在项目根或 `figma-cache/reports/runtime/` 写 `.cjs` 胶水；可选 **`--stdin`**、**`--materialize-staging`**、**`--staging-dir=<dir>`**（目录内标准名 `mcp-raw-get-*.txt/xml/json` 或 `{nodeId}-dc.txt` 约定）。批量域清单用 **`fc:mcp:cache:manifest`**；segment 迁移用 **`fc:mcp:resegment`**。若稿内说明在 MCP 输出的 **`data-annotations="…"`**（与 `data-node-id` 同标签），其落在生成组件主体内即可进入 `mcp-raw`；`fc:ensure` 会汇总到 **`spec.md`「Annotations」** 与 **`raw.json.figmaDataAnnotations`**（**不要**把关键说明只写在 `SUPER CRITICAL:` 之后，该段会被消毒裁掉）。
3. **Windows / shell**：若 `{{FIGMA_URL}}` 含 `&` 且经 cmd 拆成多段 argv，`fc:mcp:ingest` 会**自动拼回**后续 `key=value` 片段；仍失败时用 **`--url-file`**、**`FIGMA_MCP_INGEST_URL`** 或 **`--file-key`+`--node-id`**（见 `figma-cache/docs/README.md` 一页速查）。
4. 确认进程退出码为 **0**；任意失败时终端均会给出 **`log=` / `json=`**（`preflight` 与 `gate` 两类，见 `mcp-ingest-failure.json` 的 `failureKind`），仅按路径本地排查（勿把全文贴回父会话）。

**成功时回复仅限（禁止冗述）**

1. 首行：`> 🔄 Figma 缓存状态: [命中|缺失|更新] | 来源: [Local|MCP] | 节点: <node-id>`
2. 一行：`fc:mcp:ingest ok ...`（终端最后一行原文）
3. 一行节点目录：`figma-cache/files/<fileKey>/nodes/<nodeId>/`
4. 可选一行：validate / completeness 为 pass（勿展开子文件表）

**禁止**：Thought 流水账、staging 临时文件名列表、完整 manifest / MCP 长原文。

---

**索引漂移**：若磁盘已有 `mcp-raw` 但 `index.json` 缺项，可在项目根执行 `npm run fc:cache:reconcile -- --apply`（默认省略 `--apply` 即为 dry-run）。若命令行同时包含 `--dry-run` 与 `--apply`，以 **`--dry-run` 为准**（不回填索引）。
