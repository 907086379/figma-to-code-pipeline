# Changelog

本文件记录 **对外发布**（npm）时建议同步更新的变更。仓库内日常迭代可只写 Git commit message；发版前将本条目下的 **Unreleased** 归并到新版本号。

## Unreleased

- 暂无

## 2.0.0（2026-04-15）

- **`cursor init` 模板策略变更（Breaking）**：默认改为覆盖同名 `.cursor/rules` 与 `.cursor/skills` 为最新模板；`--force` 改为“保留本地已存在模板并跳过覆盖”。
- **通用低 token 规则下发**：新增 `00-output-token-budget.mdc`，并在 `cursor init` 时自动复制到项目 `.cursor/rules/`，实现“结果优先、最小回显”的默认行为。
- **Figma 缓存规则强化**：新增“`mcp-raw` 落盘后即时反精简检查”与结果输出要求（`mcp-raw anti-truncation: pass|fail`），降低摘要化回包误入缓存风险。
- **读取策略定稿**：UI/组件实现任务默认读取 `mcp-raw-get-design-context.txt` 全文；仅逻辑/流程等 UI 无关任务走 `raw/spec/manifest` 轻量读取。
- **任务书与文档同步**：`AGENT-SETUP-PROMPT.md`、`README.md`、`figma-cache/docs/README.md` 对齐上述行为，并补充低 token 协作口径。

## 1.4.5（2026-04-15）

- **文档重构**：重写 `figma-cache/docs/colleague-guide-zh.md`，统一为最新流程口径（缓存优先、证据门禁、validate 闭环、flow 白名单）。
- **入口增强**：新增 `figma-cache/docs/quick-start-zh.md` 一页式速查卡，并在根 `README.md` 与 `figma-cache/docs/README.md` 增加入口导航。
- **首页说明优化**：更新根 `README.md` 顶部描述与协作建议，强调“本地缓存优先 + 按需 MCP + 最小调用集 + 严格证据校验”。
- **流程防回归沉淀**：在命令执行防回归规则中新增 PowerShell 反引号转义案例，降低文档写入误改风险。

## 1.4.4（2026-04-15）

- **`cursor init` 配置文件体验优化**：默认确保项目根 `figma-cache.config.js`，并在可安全判定时自动清理 legacy `figma-cache.config.example.js`，避免流程完成后残留示例文件造成混淆。
- **postEnsure 默认优化**：`figma-cache.config.example.js` 的 adapter 提示改为目录级单文件（`figma-cache/docs/figma-cache-adapter-hint.md`）默认写入，避免每节点重复生成。
- **按需开关**：新增 `FIGMA_CACHE_ADAPTER_DOC_MODE`（`cache-root`/`node`/`off`）、`FIGMA_CACHE_ADAPTER_DOC_CACHE`、`FIGMA_CACHE_ADAPTER_DOC_WRITE_POLICY` 环境变量。
- **文档与任务书同步**：更新 `AGENT-SETUP-PROMPT.md`、`cursor-bootstrap/AGENT-SETUP-PROMPT.md`、`figma-cache/docs/README.md`、`cursor-bootstrap/examples/README.md`，统一“目录级优先、节点按需”口径。

## 1.4.3（2026-04-15）

- **文档修复**：重写根 `README.md`，修复历史乱码并统一为可读中文说明。
- **编码护栏**：在 Core Rule 与本地缓存 Skill 中新增「Encoding And Anti-Mojibake」强制约束，明确 UTF-8 写入与乱码处理流程。
- **自动检查**：新增 `docs:encoding:check`（`scripts/check-doc-encoding.js`），用于检测 `.md/.mdc` UTF-8 解码异常与常见乱码片段。
- **发布前门禁**：`test` 与 `prepack` 脚本前置 `docs:encoding:check`，在测试与打包阶段自动拦截乱码文档。

## 1.4.2（2026-04-15）

- **CLI**：新增 `budget` 子命令与 `figma:cache:budget` script，预算主字段统一为 `tokenProxyBytes`，保留 `tokenProxyChars` 兼容。
- **CLI 安全**：`ensure --source=figma-mcp` 默认阻止“假成功”；仅在显式 `--allow-skeleton-with-figma-mcp` 时允许骨架模式。
- **规则/技能与文档**：统一 v2 流程口径（先 MCP 写 `mcp-raw/`，再 `upsert/ensure`），补充大文件读取策略与预算说明。
- **模板**：`AGENT-SETUP-PROMPT.md` 与 `cursor-bootstrap/AGENT-SETUP-PROMPT.md` 同步更新 v2 提示词。
- **文档修正**：根 `README.md` 里的 `npm run figma-cache:validate` 更正为 `npm run figma:cache:validate`。

## 1.4.1（2026-04-14）

- **根 `README.md`**：增加 **「升级 npm 包后推荐流程（业务项目）」** 小节。

## 1.4.0（2026-04-14）

- **文档**：新增 **`figma-cache/docs/colleague-guide-zh.md`**（团队使用场景与流程，随 npm 包分发）；根 **`README.md`** / **`figma-cache/docs/README.md`** 增加入口链接。
- **文档整理**：删除 **`migration-guide.md`**、**`backfill-guide.md`**、**`validation-checklist.md`**，其内容并入 **`figma-cache/docs/README.md`**；根 **`README.md`**、**`colleague-guide-zh.md`**、**`AGENT-SETUP-PROMPT.md`** 中的引用已改为指向 **`figma-cache/docs/README.md`**。
- **`colleague-guide-zh.md`**：扩充适用场景与 **Cursor 提示词模板**（单条、多条建联、渐进式 `flow link` / `flow chain`、仅缓存不写代码等）；文首增加 **术语与专用名词（速查）** 表；增加 **§5.9 大批量链接两阶段**、**§5.10 少量 + flow 亦维护业务流程 md**。
- **`cursor init`**：每次运行将 **`colleague-guide-zh.md`** 从包内**同步到项目** `FIGMA_CACHE_DIR/colleague-guide-zh.md`（默认 `figma-cache/`），与 `AGENT-SETUP-PROMPT.md` 同为**每次刷新**；JSON 增加 `colleagueGuideFile` / `colleagueGuideSynced` 等字段；`--help` 说明同步。
- **根 `README.md`**：改为面向**使用者**的简明说明；维护发版指引改指向 **`figma-cache/docs/README.md`** / **`CHANGELOG.md`**。
- **`postEnsure` ctx**：增加 **`url` / `source` / `syncedAt` / `completeness`**，便于钩子写文档。
- **`figma-cache.config.example.js`**：默认 **`postEnsure`** 除节点内 `figma-cache-adapter-hint.md` 外，增量维护 **`docs/figma-flow-readme.md`**（路径由 **`FIGMA_CACHE_FLOW_README`** 覆盖）；**`figma-cache/docs/README.md`**、**`colleague-guide-zh.md`** 已补充说明。
- **`AGENT-SETUP-PROMPT.md`**：收尾可选提示阅读 **`figma-cache/docs/colleague-guide-zh.md`** §5.9～§5.10（大批量链接与业务流程文档）。

## 1.3.2

- **`cursor init`**：终端下一步改为**单一方式**（`@AGENT-SETUP-PROMPT.md`）；并提示 **Agent 完成后**执行 **`npm run figma:cache:init`**（无 script 时用 **`npx figma-cache init`**）；JSON 内 `agentPromptNote` 同步。
- **`AGENT-SETUP-PROMPT.md`**：收尾步骤补充「若无 `figma-cache/index.json` 则提示执行 cache init」。
- **文档**：根 **`README.md`** 改为「四步」接入；**`figma-cache/docs/README.md`**、**`migration-guide.md`** 与上述流程对齐。

## 1.3.1

- **`AGENT-SETUP-PROMPT.md`**：写入时用包内 `package.json` 的 **`name`** 替换 `{{NPM_PACKAGE_NAME}}`（fork 改名后路径自动一致）。
- **`package.json`**：增加 **`homepage`**（npm 包页）；**`npm test`** 运行零依赖 **`tests/smoke.js`**（normalize / config / 未知子命令退出码）。
- **CI**：在 validate 前执行 **`npm test`**。

## 1.3.0

- **`cursor init`**：每次运行后刷新项目根 **`AGENT-SETUP-PROMPT.md`**（完整 Agent 任务书）；终端打印下一步说明（`@` 文件或粘贴）。
- **`figma-cache.config.example.js`**：改为指向 `AGENT-SETUP-PROMPT.md`，去掉重复长提示。
- **README / migration-guide**：以「仅 npm、三步走」为主，避免依赖未随包分发的路径；可选 Vue2+Vuetify2 示例写明在 `node_modules/.../examples/`。

## 1.2.0

- **通用化**：默认 Adapter 改为 **`02-figma-stack-adapter.mdc`**（栈占位）；Vue2+Vuetify2 全文迁至 **`cursor-bootstrap/examples/vue2-vuetify2-adapter.reference.mdc`**。
- **`figma-cache.config.example.js`**：`postEnsure` 默认仅写中性 **`figma-cache-adapter-hint.md`**，内含 Agent 提示；`cursor init` 会复制到项目根。
- 本仓库 **`figma-cache.config.js`** 改为 re-export 示例文件，便于与包内模板保持一致。

## 1.1.0

- **CLI**：`figma-cache cursor init [--force]` — 将包内 `cursor-bootstrap/` 复制到当前项目根的 `.cursor/rules` 与 `.cursor/skills/figma-mcp-local-cache/`；默认跳过已存在文件，`--force` 覆盖。
- **分发**：`package.json` 的 `files` 包含 `cursor-bootstrap/`。

## 1.0.0

- 初版：Figma 链接标准化、本地 `index.json` / `files/` 流程、`validate` / `flow` 子命令、可选 `figma-cache.config.js` 的 `hooks.postEnsure`。
- 发布形态：`bin/figma-cache.js` 薄封装、`files` 白名单默认不包含业务缓存目录。
- `prepack` 校验、`publishConfig.registry`、`keywords`、`.gitignore`、`GitHub Actions` CI 等维护项。
