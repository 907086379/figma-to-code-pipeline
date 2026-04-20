# Figma Cache：请 Agent 一次性完成项目适配

> **给 Cursor Agent 的指令**：你正在操作的是**用户业务项目**的根目录。以下文件应已存在（由 `npx figma-cache cursor init` 从 npm 包 **`figma-to-code-pipeline`** 复制到当前仓库根）：
> - `.cursor/rules/01-figma-cache-core.mdc`
> - `.cursor/rules/00-output-token-budget.mdc`（通用低 token 输出基线）
> - `.cursor/rules/02-figma-stack-adapter.mdc`（**占位**，任务完成后需删除）
> - `.cursor/rules/figma-local-cache-first.mdc`（可选保留）
> - `.cursor/skills/figma-mcp-local-cache/SKILL.md`
> - `figma-cache.config.js`（示例 `postEnsure`：目录级 adapter hint + 可选 `docs/figma-flow-readme.md`）
> - （兼容旧项目）`figma-cache.config.example.js` 可能存在；仅当内容被用户自定义且无法安全迁移时保留

## 你必须完成的任务（按顺序执行，尽量少问用户）

1. **读取工程事实**  
   阅读 `package.json` 及存在的构建配置（如 `vite.config.*`、`vue.config.js`、`next.config.*`、`tsconfig.json` 等），**自行推断** UI 技术栈（框架、组件库、样式方案、状态管理若有则记录）。仅在关键信息完全无法从仓库推断时，再向用户提一个极简问题。

2. **检查并合并 `figma-cache.config.js`**  
   - 若根目录**不存在** `figma-cache.config.js`：基于当前文件创建完整配置，并实现与栈匹配的 `hooks.postEnsure`。  
   - 若**已存在** `figma-cache.config.js`：**合并**而非盲目覆盖——保留用户已有非 figma-cache 字段，仅补充或调整 `hooks.postEnsure` 及与 figma-cache 相关的导出；冲突时以「不破坏用户现有逻辑」优先并注释说明。  
   - 默认建议：`FIGMA_CACHE_ADAPTER_DOC_MODE=cache-root`（目录级单文件，减少重复）；仅在团队明确需要节点文档时改为 `node`。

3. **清理 legacy example（若安全）**  
   若根目录存在 `figma-cache.config.example.js` 且其内容与 `figma-cache.config.js` 等价（或为未改动模板），请删除该 example 文件，避免后续协作混淆。

4. **生成栈专属 Adapter 规则**  
   新建 **`.cursor/rules/02-figma-<栈简名>-adapter.mdc`**（`alwaysApply: false`）。内容须与 **`01-figma-cache-core.mdc`** 边界一致：只约束「在通用缓存可读之后如何写业务 UI」；**禁止**要求在 `meta.json` / `raw.json` / `spec.md` 中写入框架专有实现。

5. **删除占位规则**  
   确认第 4 步文件已写入且无语法问题后，**删除** `.cursor/rules/02-figma-stack-adapter.mdc`。若用户在 Cursor 设置里固定引用了该文件名，请在汇报中提示用户改为引用新的 `02-figma-<栈>-adapter.mdc`。

6. **补全 npm scripts（若缺失）**  
   若 `package.json` 中没有任何 `fc:*` 脚本，请追加一组，命令使用 **`npx figma-cache`** 或 **`figma-cache`**（与项目是否已安装本包、以及 `node_modules/.bin` 是否可用一致即可，优先 `npx figma-cache` 以减少环境差异）。至少包含：`init`、`config`、`validate`、`ensure`、`get`（名称与 `figma-cache --help` 或包内 **`figma-cache/docs/README.md`** 中 scripts 示例一致即可）。

7. **收尾**  
   - 用简短列表向用户汇报：新建/修改/删除了哪些路径。  
   - 若项目根**尚无** `figma-cache/index.json`，提示用户执行：`npm run fc:init`（若已加 script）或 `npx figma-cache init`（与 `cursor init` 不同，用于创建空索引与缓存目录）。  
   - 提示用户在本项目根执行：`npm run fc:validate`（若已加 script）或 `npx figma-cache validate`。  
   - 说明：后续 Figma 相关对话将主要由 **01 Core + 新 Adapter + Skill** 驱动。  
      - **可选**：若项目已通过 `cursor init` 同步 `figma-cache/docs/colleague-guide-zh.md`，提示团队默认只使用 **§5.1「最推荐主提示词」**，只有特殊诉求再追加 **§5.2** 的一句附加要求。

## 输出与 token 约束（强制）
- 默认“只要结果”：不输出思考过程，不粘贴 MCP 长回包。
- 执行 Figma MCP 后，用户可见回复只保留：缓存状态、调用次数、产物路径、校验结论、失败修复动作。
- 除非用户明确要求，禁止在 chat 中贴出 `get_design_context` 全文；原始内容仅保存到 `mcp-raw/*`。

## 硬约束（违反则视为未完成）

- **不要**修改 `node_modules/figma-to-code-pipeline/` 下已发布包内文件（应无此必要）。  
- **不要**修改 `figma-cache/figma-cache.js` 或破坏 Core「框架中立」语义。  
- **不要**把业务路由名、具体组件库 API 写进 `figma-cache/files/**` 下的 `meta.json` / `raw.json` / `spec.md`。
- **不要**把 `flow` 设为默认 completeness；必须保持默认 `layout,text,tokens,interactions,states,accessibility`，并仅在 flow 白名单命中时追加（关系关键词或多链接串联意图）。
- **必须**在按本文件完成全部任务且验证成功后，删除本文件 `AGENT-SETUP-PROMPT.md`，避免重复执行；若删除失败或仍存在该文件，视为任务未完成。

## 可选参考（仅在用户需要 Vue2+Vuetify2 时）

包内附带参考文本（**不在 init 时复制到 .cursor**）：  
`node_modules/figma-to-code-pipeline/cursor-bootstrap/examples/vue2-vuetify2-adapter.reference.mdc`  
若用户明确要求该栈，可读入后改写为第 4 步的 Adapter 规则内容。

---

**开始执行：**读完本文件后立刻按上述顺序操作仓库文件，直至全部完成。
