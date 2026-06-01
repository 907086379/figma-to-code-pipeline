# Figma Cache

该目录集中管理 Figma 缓存流程（脚本、索引、规范、样例缓存）。

## 一页速查（默认先读本节）

人类同事：**日常协作优先读本节**；命令全集、环境变量、UI gate、`flow` 等见下文。

### 日常三步

1. 把 Figma 链接和目标发给 Agent（是否强制刷新写清楚）。
2. 有流程关系时写明前后页 / 分支 / 跳转。
3. 确认回报含：缓存状态、来源、MCP 调用次数、输出文件（或 `fc:mcp:ingest` 退出码）。

### 默认执行链

先 **`cursor init` + AGENT-SETUP** → **`npx figma-cache project-setup finish`**（写 `project-setup.manifest.json`）→ 查本地缓存 → 按需 MCP → **`mcp-raw/`** 落盘（ingest 一条龙）。批量前：`figma-cache validate --strict-project --hygiene`。

### project-setup 与 Agent 门禁（4.4+）

| 命令 | 说明 |
|------|------|
| `figma-cache project-setup finish` | AGENT-SETUP 完成后登记 `complete` |
| `figma-cache validate --strict-project` | 未完成 setup 则失败 |
| `figma-cache validate --hygiene` | 禁止 `reports/runtime/*.cjs` 胶水 |
| `fc:doctor -- --strict` | 含 ui-batch + projectSetup + hygiene |

详见仓库根 **`docs/AGENT-RUNTIME-GUARDRAILS.md`**。

### MCP 回包落盘（`fc:mcp:ingest`）

**Windows / pnpm（推荐）**

```bash
pnpm run fc:mcp:ingest:url -- "https://www.figma.com/design/...?node-id=12-34"
```

**勿用** `pnpm run fc:mcp:ingest:quiet -- --url "..."`（多余 `--` 会导致 preflight 失败）。**禁止**在 `figma-cache/reports/runtime/` 写 `.cjs` 胶水；只用 **`--stdin`** 或官方 **`--materialize-staging`**。

### MCP 回包落盘（文件参数 / stdin）

在 Cursor 等环境调用 MCP 拿到三段原始文本后，保存为文件或使用 stdin JSON，再执行：

```bash
npm run fc:mcp:ingest:quiet -- --url="<含 node-id 的 Figma 链接>" \
  --design-context-file=tmp/mcp-raw-get-design-context.txt \
  --metadata-file=tmp/mcp-raw-get-metadata.xml \
  --variable-defs-file=tmp/mcp-raw-get-variable-defs.json
```

（等价于 `npm run fc:mcp:ingest -- --quiet ...`；需要完整 JSON 明细时用 `fc:mcp:ingest` 且不加 `--quiet`。）

也可用 **`--stdin`** 从管道读 JSON（键名含 `get_design_context` / `get_metadata` / `get_variable_defs`）。

默认行为：写入约定文件名、`mcp-raw-manifest.json`（sha256 / size / toolCalls），并串联 **`fc:ensure --source=figma-mcp`** → **`fc:validate`** → **`fc:budget --mcp-only`**。成功路径推荐 **`npm run fc:mcp:ingest:quiet`**（内置 `--quiet`，末行仅摘要）。需要刷新派生物时在**同一条命令**上加 **`--enrich`**。可用 **`--skip-budget`** 跳过 budget（少见）。完整选项：`npm run fc:mcp:ingest -- --help`。

### 稿内标注 `data-annotations`（与 MCP 尾部消毒）

- Figma MCP 常在生成标签上与 `data-node-id` 并列输出 **`data-annotations="…"`**（设计说明写在代码属性里，而非单独附录文件）。
- **`fc:mcp:ingest` 默认消毒**只裁掉从 **`SUPER CRITICAL:`** 起到文末的 MCP 说明尾，**不会**去掉组件主体里的 `data-annotations`。
- **`fc:ensure` hydrate** 会从 `mcp-raw-get-design-context.txt` 扫描这些属性，写入 **`spec.md` 的「Annotations（稿内 data-annotations）」** 与 **`raw.json.figmaDataAnnotations`**（并在 `raw.json.evidenceSummary.figmaDataAnnotationCount` 计数），便于 Agent/研发首轮必读。

### `fc:mcp:gate`（仅修补场景）

走 **`fc:mcp:ingest` 时不必再跑 gate**。仅在 **手工改了磁盘上的 `mcp-raw/`、未执行 ingest** 时，用 gate 做全索引 **`validate` + `fc:budget --mcp-only`**；需要 **`enrich --all`** 时用 `npm run fc:mcp:gate -- --enrich`。详见 `npm run fc:mcp:gate -- --help`。

### 三条红线

- `ensure` 不是 MCP 拉取器。
- `source=figma-mcp` 但没有 `mcp-raw/` 证据，不算完成。
- `upsert` / `ensure` 后 `validate` 未通过，不算完成。

### completeness 与 flow（记忆法）

- 默认：`layout,text,tokens,interactions,states,accessibility`
- `flow` 仅在关系关键词或多链接串联意图时自动追加
- 仅视觉微调 / 单链接无关系 / 仅资产导出：通常不自动补 `flow`

### 主提示词（可复制）

```text
请按项目 figma 缓存规则处理下面链接：先查本地缓存，未命中或字段不足再按需调用 figma-mcp；三段回包只用 npm run fc:mcp:ingest:quiet 落盘（已含 ensure、validate、budget；派生物加 --enrich）。请回报缓存状态、来源、MCP 调用次数、fc:mcp:ingest 退出码、输出文件清单；若自动补 flow，请说明触发原因。

[Figma 链接]
```

### 排障常用命令

```bash
npm run fc:config
npm run fc:get -- "<figma-url>"
npm run fc:validate
npm run fc:budget
```

### Windows / shell：`--url` 中的 `&`（例如 `&m=dev`）

**脚本已自动处理（默认）**：`fc:mcp:ingest` 在解析参数前会把紧跟在 `--url=…` / `--url …` 之后、形如 **`key=value`** 的独立 argv（常见为 **`m=dev`**）拼回 URL，仅在已识别为 **`figma.com` 且含 `node-id=`** 时生效（实现见 `scripts/workflow/mcp-ingest-argv.cjs`）。因此 **`npm run fc:mcp:ingest:quiet -- --url=…?node-id=…&m=dev`** 在多数 Windows/cmd 拆词场景下可直接成功。

**仍失败或需完全绕开 shell 时的备选**：

1. **`--url-file=<path>`**：文件首行写完整 URL（UTF-8）。
2. **环境变量 `FIGMA_MCP_INGEST_URL`**：不设 `--url`，由进程环境提供整串 URL。
3. **`--file-key` + `--node-id`**：不传含 `&` 的长 URL。
4. **手工精简 URL**：去掉 `&` 及之后参数（`node-id` 已足够 ingest 定位）。

---

## 从 npm 包接入业务项目（顺序一览）

若通过 **`figma-to-code-pipeline`** 安装（而非整仓拷贝本目录），推荐顺序为：

1. `npm i -D figma-to-code-pipeline`
2. `npx figma-cache cursor init`（写入 `.cursor/` 等，并刷新根目录 **`AGENT-SETUP-PROMPT.md`**）
3. 在 Cursor 中 **`@AGENT-SETUP-PROMPT.md`** 并让 Agent 按文档执行（栈配置、Adapter、`fc:*` scripts 等）
4. **`npm run fc:init`**（若尚无 script，用 **`npx figma-cache init`**）→ 生成 **`figma-cache/index.json`**

说明：**`cursor init`** 与 **`figma-cache init`** 是两件事；后者才是本地缓存数据目录与空索引。仓库根 **`README.md`**（npm 包首页文档）中有与上述一致的「四步」说明。

**文档分工**：**本文件**为随包分发的**唯一主手册**（含 **一页速查** 与下文命令全集）。**`colleague-guide-zh.md`** 为团队可转发摘要（术语表、首次接入、升级）。**`quick-start-zh.md`** 仅保留兼容书签，指向本文件「一页速查」。

## 使用方式（与「一页速查」的关系）

- **人类**：日常只需把 Figma 链接发给 Agent；命令多用于排障。口径以 **一页速查** 为准。
- **Agent**：行为以 `.cursor/rules` 与 Skill 为准；落盘默认 **`npm run fc:mcp:ingest:quiet`** 一条龙（`ensure` → `validate` → `budget`；派生物加 **`--enrich`**），**不必再单独跑 gate**。

## 目录结构

- `figma-cache/figma-cache.js`：缓存流程脚本主入口
- `figma-cache/index.json`：全量索引
- `figma-cache/files/...`：节点缓存内容
- **`figma-cache/docs/README.md`**：接入、一页速查、scripts、环境变量、人工校验与回填（本文件，随包分发的主文档）
- **`figma-cache/docs/colleague-guide-zh.md`**：团队向摘要（术语、首次接入）；**`npx figma-cache cursor init` 会写入/刷新**（与 `FIGMA_CACHE_DIR` 下路径一致）
- **`figma-cache/docs/quick-start-zh.md`**：兼容旧链接，内容已并入本文件「一页速查」
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
- **`npm run fc:mcp:ingest:quiet`**（推荐）：同上，且默认 **`--quiet`** 单行摘要；等价于 **`npm run fc:mcp:ingest -- --quiet`**
- **`npm run fc:mcp:ingest`**：需要脚本首部 JSON 明细（manifest 摘要）时不加 `--quiet`
- **`npm run fc:mcp:gate`**：仅**未跑 ingest**、手工改了 `mcp-raw` 等修补场景下，做全量 `validate` + `budget`；可选 **`--enrich`** 为 `enrich --all`；见上文「一页速查」→「`fc:mcp:gate`」
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
- `npm run fc:ui:gate`
- `npm run fc:ui:gate:pr`
- `npm run fc:ui:gate:main`
- `npm run fc:budget`（默认 `--mcp-only`）
- `npm run fc:stale`
- `npm run fc:backfill`
- `npm run fc:doctor`（UI batch 兼容诊断：route mode / targetRoot 风险 / mountMode 与 mountPage 可用性；`--strict` 仅拦 blocking findings，缺 config 为 advisory）
> 注意：`ensure` 默认职责是“写索引 + 生成骨架文件”，不是 MCP 拉取器。  
> 当 `upsert/ensure` 传 `--source=figma-mcp` 且未显式允许骨架模式时，CLI 会先执行 MCP 原始证据门禁（缺失即失败，退出码 2）。
> 正确流程是先由 Agent/Figma MCP 获取最小调用集并写入 `mcp-raw/`（推荐 **`fc:mcp:ingest:quiet`** / **`fc:mcp:ingest`**，已含 `validate` 与 `budget`）。**`fc:mcp:gate`** 仅用于未走 ingest 的修补（见上文「一页速查」）。

### auto-routes 友好默认（新增）

- 推荐 profile：`vue3-vite-auto-routes-tailwind`
- 默认 `targetRoot`：`./src/components/figma-batch`（避免写入 `src/pages/**`）
- 默认 `mountMode`：`manual`（只登记 batch + 写 `target.entry` 组件，**不**自动改业务页面）
- Agent 典型链路：`fc:mcp:ingest(:quiet)` → `fc:batch:add` → 实现 `target.entry` → `fc:ui:preflight` / `fc:ui:accept`
- 更新已有 case：未显式 `--target` / `--target-root` 时保留原 `target.entry`（防静默漂移）
- 需要预览页联调时显式设置：`mountMode=auto`（并提供或探测 `mountPage`）；**无** `ui-mount-batch --all`
- 可通过 `--profile` / `FIGMA_UI_BATCH_PROFILE` / `figma-ui-batch.config.json` 覆盖
- 常见风险：auto-routes 项目勿把 batch 产物写入 `src/pages/**`；PowerShell 传 Figma URL 时注意 `&` 引号

### Fresh 重生成回归（推荐）

以下脚本名需在**目标业务项目**的 `package.json` 中定义（本仓库的 `vue-demo` 已提供同名示例：`fc:workflow:fresh:*`）。

- 目标项目推荐一条命令：`npm run fc:workflow:fresh:one-shot`（删 -> 等文件 -> 验收 + build）
- 备选拆分：
  - `npm run fc:workflow:fresh:start`（删除 target，并要求“缺失目标失败”）
  - `npm run fc:workflow:fresh:verify`（Agent 重生成后验收通过）
  - `npm run fc:workflow:fresh:wait-verify`（仅等待 target 出现后自动验收）
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
- 挂载策略：
  - `mountMode=manual/off`：代码级验收（只校验 target 组件实现）
  - `mountMode=auto`：额外校验 batch 中 `mount.mountPage` 是否存在
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
| `FIGMA_MCP_INGEST_URL` | **`fc:mcp:ingest` 专用**：整串 Figma URL（可含 `&`）；未传 `--url` 时使用，避免 cmd 对命令行中 `&` 的拆词 |
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







