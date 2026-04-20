# Figma Cache

该目录集中管理 Figma 缓存流程（脚本、索引、规范、样例缓存）。

## 从 npm 包接入业务项目（顺序一览）

若通过 **`figma-to-code-pipeline`** 安装（而非整仓拷贝本目录），推荐顺序为：

1. `npm i -D figma-to-code-pipeline`
2. `npx figma-cache cursor init`（写入 `.cursor/` 等，并刷新根目录 **`AGENT-SETUP-PROMPT.md`**）
3. 在 Cursor 中 **`@AGENT-SETUP-PROMPT.md`** 并让 Agent 按文档执行（栈配置、Adapter、`fc:*` scripts 等）
4. **`npm run fc:init`**（若尚无 script，用 **`npx figma-cache init`**）→ 生成 **`figma-cache/index.json`**

说明：**`cursor init`** 与 **`figma-cache init`** 是两件事；后者才是本地缓存数据目录与空索引。仓库根 **`README.md`**（npm 包首页文档）中有与上述一致的「四步」说明。

团队向长文（可转发同事）：**`colleague-guide-zh.md`**。`quick-start-zh.md` 可作新人一页式速查入口。

## 使用方式（重要）

- 日常只需要把 Figma 链接发给 agent。
- agent 会自动完成：缓存查询 -> 必要时调用 MCP -> 回写缓存 -> 校验。
- 你不需要手动执行命令，命令主要用于排障和迁移验证。

## 目录结构

- `figma-cache/figma-cache.js`：缓存流程脚本主入口
- `figma-cache/index.json`：全量索引
- `figma-cache/files/...`：节点缓存内容
- **`figma-cache/docs/README.md`**：接入、scripts、环境变量、人工校验与回填（本文件，随包分发的主文档）
- **`figma-cache/docs/colleague-guide-zh.md`**：团队向说明与提示词模板；**`npx figma-cache cursor init` 会写入/刷新**（与 `FIGMA_CACHE_DIR` 下路径一致），便于纳入版本库、不必从 `node_modules` 手抄
- `figma-cache/docs/quick-start-zh.md`：一页式同事速查卡（建议新人先读）
- `figma-cache/docs/link-normalization-spec.md`：链接标准化规则（Core / Skill 会引用）
- `figma-cache/docs/flow-edge-taxonomy.md`：流程边类型约定

## 默认配置

- `FIGMA_CACHE_DIR=figma-cache`
- `FIGMA_CACHE_INDEX_FILE=index.json`
- `FIGMA_ITERATIONS_DIR=library/figma-iterations`
- `FIGMA_CACHE_STALE_DAYS=14`
- `FIGMA_DEFAULT_FLOW`：默认 flowId；设置后 `flow add-node/link/chain/show/mermaid` 可省略 `--flow=...`

查看当前配置：

```bash
npm run fc:config
```

PowerShell 示例（设置默认 flow，减少重复参数）：

```powershell
$env:FIGMA_DEFAULT_FLOW="sip-calling-phase1"
npm run fc:config
```

## 常用命令（通常由 agent 自动执行）

- `npm run fc:init`
- `npm run fc:get -- "<figma-url>"`
- `npm run fc:ensure -- "<figma-url>" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility`
- `npm run fc:upsert -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`
- `npm run fc:upsert -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens --allow-skeleton-with-figma-mcp`（仅写骨架，后续仍需 `validate` 通过）
- `npm run fc:ensure -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens --allow-skeleton-with-figma-mcp`（仅写骨架，后续仍需 `validate` 通过）
- 若不传 `--completeness`，CLI 默认即使用：`layout,text,tokens,interactions,states,accessibility`
- 自动追加 `flow` 仅限白名单：关系关键词（关联/流程/跳转/前后页/上一步/下一步/分支/链路/路径/from/to/next/branch），或同轮/断续多链接且明确先后/串联意图
- 单链接且无关系意图、仅视觉微调、仅资产导出时，不自动追加 `flow`
- 若自动追加了 `flow`，Agent 输出中必须记录触发原因：`关键词命中` 或 `多链接串联意图`
- `npm run fc:validate`
- `npm run fc:ui:preflight`
- `npm run fc:ui:audit -- --min-score=85`
- `npm run fc:ui:report:aggregate`
- `npm run fc:ui:accept -- --target=<componentPath>`
- `npm run fc:ui:e2e:cross -- --target-project=../vue-demo --fileKey=<fileKey> --nodeId=9277-28772 --target=./src/pages/main/components/AudioSettingsPanel.vue`（路径均相对于各自根目录；`../vue-demo` 表示与 toolchain 并列）
- `npm run fc:ui:gate`
- `npm run fc:ui:gate:pr`
- `npm run fc:ui:gate:main`
- `npm run fc:budget`（默认 `--mcp-only`）
- `npm run fc:stale`
- `npm run fc:backfill`
> 注意：`ensure` 默认职责是“写索引 + 生成骨架文件”，不是 MCP 拉取器。  
> 当 `upsert/ensure` 传 `--source=figma-mcp` 且未显式允许骨架模式时，CLI 会先执行 MCP 原始证据门禁（缺失即失败，退出码 2）。
> 正确流程是先由 Agent/Figma MCP 获取最小调用集并写入 `mcp-raw/`，再执行 `upsert/ensure` 与 `validate`。

### Fresh 重生成回归（推荐）

- 目标项目推荐一条命令：`npm run figma:workflow:fresh:one-shot`（删 -> 等文件 -> 验收 + build）
- 备选拆分：
  - `npm run figma:workflow:fresh:start`（删除 target，并要求“缺失目标失败”）
  - `npm run figma:workflow:fresh:verify`（Agent 重生成后验收通过）
  - `npm run figma:workflow:fresh:wait-verify`（仅等待 target 出现后自动验收）
- `cross-project-e2e` 默认开启真实组件链路保护：`target` 缺失或出现 `code-level comparison skipped` 会直接失败

### UI preflight（P0 门禁）

- `npm run fc:ui:preflight`：读取 `index.json`、adapter contract 与节点关键文件，输出结构化报告到 `figma-cache/reports/ui-preflight-report.json`
- 支持参数：`--cacheKey=<fileKey#nodeId>`、`--contract=<path>`、`--report=<path>`、`--allow-warn`
- 阻断项返回退出码 `2`：包括 cacheKey 不存在、关键文件缺失、coverage evidence 不完整、contract 缺失或映射为空、`source=figma-mcp` 时缺失 `mcp-raw-manifest.json`
- warning 项（不阻断）会提示 `spec.md`/`state-map.md` 中的 TODO 占位

### UI gate（含 preflight 前置）

- `npm run fc:ui:gate`：`verify:static` → `fc:ui:preflight` → `fc:ui:audit -- --min-score=85` → `fc:validate` → `test:node`
- `npm run fc:ui:gate:pr`：PR 最低门槛（`verify:static` + preflight + validate）
- `npm run fc:ui:gate:main`：主干门槛（`verify:static` + preflight + audit90 + aggregate + validate + test:node）

### UI 1:1 audit（P1 质量评分）

- `npm run fc:ui:audit -- --cacheKey=<fileKey#nodeId> --target=<componentPath> --min-score=85`
- 默认报告：`figma-cache/reports/ui-1to1-report.json`
- 报告结构遵循：`figma-cache/docs/ui-1to1-report.schema.json`
- 评分字段：`score.total/layout/text/token/state/interaction`
- `score.total` 低于 `--min-score` 会返回退出码 `2`（可用于 CI 门禁）
- 审计底层使用通用事实标准化层：`figma-cache/js/ui-facts-normalizer.js`，统一读取 `spec/raw/state-map/mcp-raw`，避免只对单一组件类型优化

### Recipe 机制（P2）

- 目录：`figma-cache/adapters/recipes/`
- 当前内置（前10类高频组件覆盖）：`select`、`input`、`modal`、`table`、`button`、`checkbox`、`radio`、`tabs`、`tooltip`、`card`
- 每个 recipe 约束：结构模板、状态机、token 优先级、常见陷阱
- recipe 为可选命中，不会默认强制所有节点套用，避免损害通用性

### Contract 规则增强与节点 override（P2）

- `ui-adapter.contract.json` 现支持：
  - `layoutRules`
  - `typographyRules`
  - `interactionRules`
- `contract-check` 现支持规则级校验（基于 spec/state/raw 内容）
- 节点 override：`figma-cache/files/<fileKey>/nodes/<nodeId>/ui-override.json`
  - 只用于节点差异
  - 已内置与全局 contract 的冲突检测（token 绑定冲突、requiredStates 缺失）

### Profile 分层与报告聚合（P3）

- 环境变量：`FIGMA_UI_PROFILE=fast|standard|strict`（默认 `standard`）
- `fast`：audit 默认阈值 70
- `standard`：audit 默认阈值 85
- `strict`：preflight warning 计入阻断、audit 默认阈值 92 且要求 `--target`
- 报告聚合：`npm run fc:ui:report:aggregate`
  - 输出：`figma-cache/reports/ui-quality-summary.json`

### 一键自动验收（效果导向）

- `npm run fc:ui:accept -- --cacheKey=<fileKey#nodeId> --target=<componentPath> --min-score=90`
- 自动流程：preflight -> audit -> aggregate -> 验收判定
- 默认严格判定：
  - preflight 必须无 blocking
  - audit score 不低于阈值
  - 必须提供并命中 `targetPath`
  - warning/diff 需在阈值内（可通过 `--max-warnings`、`--max-diffs` 调整）

### 严格 validate 规则（默认）

- `validate` 会检查 `raw.json.coverageSummary.evidence` 与 `completeness` 是否一致。
- 当 `source=figma-mcp` 且声明 `interactions/states/accessibility` 时，不允许保留 TODO 占位说明。
- `validate` 会检查 `mcp-raw-manifest.json` 的 `fileHashes`（sha256）与 `fileSizes`（utf8 字节数），并逐项比对原始文件；缺失或不一致会直接失败。
- 若你仅想先落骨架，可使用 `--allow-skeleton-with-figma-mcp`（仅放行 upsert/ensure 写入，不放行 validate）；后续必须补齐证据并通过 `validate`。

### 预算统计（token/调用）

- `npm run fc:budget`：输出 MCP 节点预算汇总（调用次数、原始文件体积、token 代理值）。
- 预算字段统一使用 `tokenProxyBytes`（基于 `mcp-raw-get-design-context.txt` 文件大小估算）。
- 兼容字段 `tokenProxyChars` 仍保留，便于旧脚本平滑迁移。

## 流程关系（Flow）

`index.json` 现在包含 `flows`，用于维护“业务/交互流程”的节点集合与边关系。

常用命令：

- `npm run fc:flow:init -- --id=sip-calling-flow --title="SIP Calling"`
- `npm run fc:flow:add-node -- --flow=sip-calling-flow "<figma-url>"`（要求 `items` 已存在；如需同时创建缓存项可加 `--ensure`）
- `npm run fc:flow:link -- --flow=sip-calling-flow "<fromUrl>" "<toUrl>" --type=next_step`
- `npm run fc:flow:chain -- --flow=sip-calling-flow "<url1>" "<url2>" "<url3>" --type=related`
- `npm run fc:flow:show -- --flow=sip-calling-flow`
- `npm run fc:flow:mermaid -- --flow=sip-calling-flow`

说明：

- `items` 仍然是单节点缓存索引。
- `flows` 负责把多个 `cacheKey` 组织成流程图，并记录边类型（如 `next_step/branch/related`）。

## 大迭代工作流（推荐）

1. `flow init` 固定一个 `flowId`（整个迭代只用这一个，或配合 `FIGMA_DEFAULT_FLOW`）
2. 每个新节点：先 `ensure` 写入 `items`，再 `flow add-node` 挂到 flow（必要时 `--ensure`）
3. 当你描述跳转/下一步/分支：用 `flow link`；批量默认串联可用 `flow chain`
4. 定期 `validate`；需要看图用 `flow mermaid`

边类型约定见：`figma-cache/docs/flow-edge-taxonomy.md`

## 纯净版初始化

- 如果你准备移植“纯净版”（删除 `index.json` 和 `files/`），可先执行：

```bash
npm run fc:init
```

- 该命令只创建空索引，不会创建任何节点缓存文件。

---

## 复制 `figma-cache/` 接入（不安装 npm 包）

将脚本与规范**整目录**拷入业务仓库、**不**通过 `npm i figma-to-code-pipeline` 安装时：

- **建议**拷贝：`figma-cache.js` 与本目录下规范 `.md`；业务数据 `files/`、`index.json` 可按需不带，在新项目执行 **`figma-cache init`** 再 **`ensure`** 重建。
- **可选**：仓库根薄封装 `bin/figma-cache.js`；也可始终 `node figma-cache/figma-cache.js <子命令>`。
- **项目根**仍需：`figma-cache.config.js`、`.cursor/` 规则与 Skill、`AGENT-SETUP-PROMPT.md`（或由等价流程生成）。
- Vue2+Vuetify2 参考 Adapter：`cursor-bootstrap/examples/vue2-vuetify2-adapter.reference.mdc`（npm 安装时在 `node_modules/.../cursor-bootstrap/examples/`）。

说明：Cursor **不会**在 `npm install` 时写入 `.cursor/`；`npx figma-cache cursor init` 负责从包内复制模板。`cursor init` 默认**保留**同名模板（安全模式）；使用 `--overwrite` 可覆盖为最新版本；并会下发通用低 token 规则 `00-output-token-budget.mdc`；**`AGENT-SETUP-PROMPT.md` 每次 `cursor init` 均刷新**。

## package.json scripts 示例

**方式 A**（目录拷进仓库，用 `node` 调脚本）：

```json
{
  "fc:normalize": "node figma-cache/figma-cache.js normalize",
  "fc:get": "node figma-cache/figma-cache.js get",
  "fc:upsert": "node figma-cache/figma-cache.js upsert",
  "fc:ensure": "node figma-cache/figma-cache.js ensure",
  "fc:validate": "node figma-cache/figma-cache.js validate",
  "fc:budget": "node figma-cache/figma-cache.js budget --mcp-only",
  "fc:stale": "node figma-cache/figma-cache.js stale",
  "fc:backfill": "node figma-cache/figma-cache.js backfill",
  "fc:init": "node figma-cache/figma-cache.js init",
  "fc:config": "node figma-cache/figma-cache.js config",
  "fc:flow:init": "node figma-cache/figma-cache.js flow init",
  "fc:flow:add-node": "node figma-cache/figma-cache.js flow add-node",
  "fc:flow:link": "node figma-cache/figma-cache.js flow link",
  "fc:flow:chain": "node figma-cache/figma-cache.js flow chain",
  "fc:flow:show": "node figma-cache/figma-cache.js flow show",
  "fc:flow:mermaid": "node figma-cache/figma-cache.js flow mermaid",
  "fc:cursor:init": "node figma-cache/figma-cache.js cursor init"
}
```

**方式 B**（`npm i -D figma-to-code-pipeline`）：`package.json` 的 `bin` 提供 `figma-cache`，`npm run` 里可写 `figma-cache <子命令>`（走 `node_modules/.bin`）。本工具链**自身仓库根**在无自依赖时部分 npm 版本不会把当前包写入 `.bin`，故可用 `node bin/figma-cache.js <子命令>` 做自检，与方式 B 等价。

## 接入后自检

1. `npm run fc:config`（或 `npx figma-cache config`）
2. `npm run fc:validate`
3. 用真实链接试一次 `get` / `ensure`

## 环境变量（完整列表）

| 变量 | 作用 |
|------|------|
| `FIGMA_CACHE_DIR` | 缓存根目录 |
| `FIGMA_CACHE_INDEX_FILE` | 索引文件路径 |
| `FIGMA_ITERATIONS_DIR` | **仅** `backfill` 扫描的历史 Markdown 目录；不存在时扫描为空，`validate` 不受影响 |
| `FIGMA_CACHE_STALE_DAYS` | 陈旧阈值（天） |
| `FIGMA_DEFAULT_FLOW` | 默认 `flowId`（大迭代推荐设置） |
| `FIGMA_CACHE_ADAPTER_DOC` | 覆盖 adapter 提示文档基础名（默认 `figma-cache-adapter-hint.md`） |
| `FIGMA_CACHE_ADAPTER_DOC_MODE` | adapter 提示写入模式：`cache-root`（默认，目录级单文件）/ `node`（按节点）/ `off`（关闭） |
| `FIGMA_CACHE_ADAPTER_DOC_CACHE` | `cache-root` 模式下 adapter 提示文档路径（相对项目根，默认 `figma-cache/docs/figma-cache-adapter-hint.md`） |
| `FIGMA_CACHE_ADAPTER_DOC_WRITE_POLICY` | adapter 提示写入策略：`if-missing`（默认）/ `always` |
| `FIGMA_CACHE_FLOW_README` | **仅包内示例钩子**：人类可读的「流程 / 需求总览」Markdown 相对路径，默认 **`docs/figma-flow-readme.md`**；每次 `ensure` 对**新 cacheKey** 幂等追加一节 |

## 人工校验清单（对照 `validate`）

- `index.json` 存在对应 `cacheKey`
- 记录包含 `fileKey` / `scope` / `url` / `syncedAt`
- `normalizationVersion` 与当前规范一致
- `paths.meta` 与 `paths.spec` 已定义
- `completeness` 覆盖当前任务字段，且在 `raw.json.coverageSummary.evidence` 有非空对应证据
- `scope=node` 时存在 `nodeId`
- 对 `source=figma-mcp` 节点，`interactions/states/accessibility` 不得仅为 TODO 占位
- 若维护了 `flows`，边的 `from` / `to` 必须存在于 `items`

## 历史链接回填（backfill）

扫描历史文档中的 Figma 链接并补入缓存索引。

```bash
npm run fc:backfill
```

默认扫描目录由 `FIGMA_ITERATIONS_DIR` 决定（默认 `library/figma-iterations`）。完成后建议：

```bash
npm run fc:validate
npm run fc:stale
```

## Adapter 与 postEnsure

- **推荐**：`npx figma-cache cursor init` 后，在 Cursor 中 **`@AGENT-SETUP-PROMPT.md`** 由 Agent 一次性完成栈 Adapter、合并 `figma-cache.config.js`（含删除占位 `02-figma-stack-adapter.mdc`）。
- **手写**时须遵守：Core 只维护通用缓存；Adapter 只约束「读缓存后如何写业务 UI」；禁止在 `meta.json` / `raw.json` / `spec.md` 写框架专有实现。

### 包内 `figma-cache.config.example.js` 默认钩子（像素事实 + 可读流程）

`hooks.postEnsure` 会做两件事（均在 **Core 写完通用骨架之后**）：

1. **adapter 提示文档（默认目录级）**：默认在 **`figma-cache/docs/figma-cache-adapter-hint.md`** 写入单文件（可由 `FIGMA_CACHE_ADAPTER_DOC_CACHE` 覆盖），避免每节点重复；如需按节点写入，可设 `FIGMA_CACHE_ADAPTER_DOC_MODE=node`。
2. **项目根**：维护或创建 **`docs/figma-flow-readme.md`**（路径可由 **`FIGMA_CACHE_FLOW_README`** 覆盖）— 含「流程总览 / 交互边界」**手填区**，以及按 **`cacheKey` 幂等追加**的「已从 Figma 写入缓存的节点」登记（含 Figma 链接、`syncedAt`、`completeness`、相对 `spec`/`meta` 路径）。**像素级还原**仍以各节点 **`spec.md`** 为准；**用户路径图**请继续用 CLI **`flow`** 维护 `index.json`，再把 **`flow mermaid`** 贴进该 md 的 mermaid 代码块，便于评审与新人阅读。

`postEnsure` 的 **`ctx`** 还包含 **`url` / `source` / `syncedAt` / `completeness`**（与 `index.json` 中 item 一致），便于自定义钩子写文档或触发 CI。

## 包维护者

维护 **`figma-to-code-pipeline` 源码**时：见**仓库根** `README.md`（发布）与 `CHANGELOG.md`；修改 `cursor-bootstrap/`（含 `AGENT-SETUP-PROMPT.md`）或 CLI 后 bump 版本并 `npm publish`，消费方 `cursor init` 才会刷新到最新任务书。将 Core 抽成独立包、semver 与 `ctx` 约定等，可在发包前对照 `CHANGELOG` 与 `npm publish --dry-run`。







