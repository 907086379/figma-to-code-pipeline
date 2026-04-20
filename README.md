# figma-to-code-pipeline

面向业务项目的 Figma 本地缓存工具链：默认采用“本地缓存优先 + 按需 MCP + 最小调用集 + 严格证据校验 + validate 闭环”，提供链接标准化、索引与流程关系维护、缓存读写、校验与预算分析能力。该工具链聚焦“Figma -> 本地通用缓存”数据层，不直接绑定具体 UI 框架。

- npm 包：`figma-to-code-pipeline`
- Git 仓库：<https://github.com/907086379/figma-to-code-pipeline.git>

---

## 这份 README 面向谁

- npm 用户：把工具链接入业务项目并日常使用
- git 用户：在仓库内开发、测试、提交改动

> npm 发布由仓库维护者负责；普通用户和贡献者无需执行 `npm publish`。

---

## npm 用户快速开始

### 1) 安装

```bash
npm i -D figma-to-code-pipeline
```

### 2) 初始化 Cursor 模板与任务书

```bash
npx figma-cache cursor init
```

该命令会：

- 默认安全模式：保留已有 `.cursor/rules/`、`.cursor/skills/`，仅补缺失文件
- 新增通用规则：`.cursor/rules/00-output-token-budget.mdc`（全任务低 token 输出基线）
- 若需覆盖现有模板，可使用 `npx figma-cache cursor init --overwrite`
- 确保根目录存在 `figma-cache.config.js`
- 刷新根目录 `AGENT-SETUP-PROMPT.md`
- 同步刷新 `figma-cache/docs/colleague-guide-zh.md`

### 3) 初始化本地缓存索引

```bash
npm run fc:init
```

若项目还没配置 scripts，可临时使用：

```bash
npx figma-cache init
```

### 4) 执行校验

```bash
npm run fc:validate
```

---

## 团队协作建议（来自同事指南精简版）

- 默认执行链：**先查缓存** -> 按需 MCP -> 原始回包写 `mcp-raw/` -> `upsert/ensure` -> `validate`
- 当 `source=figma-mcp` 时，`mcp-raw` 证据不完整会被门禁拦截，不能只写骨架宣称成功
- 默认 completeness：`layout,text,tokens,interactions,states,accessibility`
- `flow` 仅在关系关键词命中或多链接明确串联意图时自动追加
- 回报建议包含：缓存状态、来源（Local/MCP）、MCP 调用次数、输出文件清单
- 团队可直接复用 `figma-cache/docs/colleague-guide-zh.md` 中的主提示词模板

---

## Cursor 模板固定流程（强制建议）

- 单一真源：仅手工维护 `cursor-bootstrap/` 下的 rules/skills。
- 镜像目录：`.cursor/` 视为生成产物，不手工编辑。
- 日常步骤：
  1) 修改 `cursor-bootstrap/*`
  2) 运行 `npm run verify:cursor:sync`
  3) 运行 `npm run verify:cursor`
- 守护机制：
  - CI 会执行 `verify:cursor`，若 `.cursor` 与 `cursor-bootstrap` 不一致将直接失败。
  - `npm test` 与 `prepack` 也已包含该检查，避免本地漏同步。

---

## 默认 completeness 与 token 开销

默认 completeness：`layout,text,tokens,interactions,states,accessibility`（默认不含 `flow/assets`）。

- `flow` 默认关闭，避免常规场景冗余
- 自动追加 `flow` 仅命中白名单时触发：
  - 关系关键词：`关联`、`流程`、`跳转`、`前后页`、`上一步`、`下一步`、`分支`、`链路`、`路径`、`from/to`、`next`、`branch`
  - 同轮或断续出现多个 Figma 链接，且明确存在先后/串联意图（如 A->B）
- 以下场景不自动追加 `flow`：单链接且无关系意图、仅视觉微调/文案修改、仅资产导出
- `assets` 仍按需开启，避免资产留档体积膨胀
- token 开销通常在启用 `flow` 且节点复杂时上升更明显
- 触发自动补 `flow` 时，建议在执行日志/回复中记录触发原因（关键词命中或多链接串联意图），便于审计

按需覆盖示例：

```bash
# 常规场景
npm run fc:upsert -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility

# 关联节点/同轮或断续多链接串联场景（自动或显式）
npm run fc:upsert -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility,flow

# 同时需要资产留档
npm run fc:upsert -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility,flow,assets
```

---

## 常用命令

```bash
npm run fc:init
npm run fc:config
npm run fc:get -- "<figma-url>"
npm run fc:ensure -- "<figma-url>" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility
npm run fc:upsert -- "<figma-url>" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility
npm run fc:validate
npm run fc:ui:preflight
npm run fc:ui:audit -- --min-score=85
npm run fc:ui:report:aggregate
npm run fc:ui:accept -- --target=src/components/YourComponent.tsx
npm run fc:ui:gate
npm run fc:ui:gate:pr
npm run fc:ui:gate:main
npm run fc:budget
npm run fc:stale
npm run fc:backfill
```

UI preflight/gate 说明：

- `fc:ui:preflight` 会读取缓存索引与 adapter contract，输出 `figma-cache/reports/ui-preflight-report.json`
- 若存在阻断项（如关键文件缺失、coverage evidence 缺失、contract 映射为空），命令返回退出码 `2`
- `fc:ui:audit` 会输出 `figma-cache/reports/ui-1to1-report.json`，提供 `score.total/layout/text/token/state/interaction`、`diffs`、`blocking`、`warnings`
- `fc:ui:audit` 基于 `figma-cache/js/ui-facts-normalizer.js` 统一标准化 `spec/raw/state-map/mcp-raw` 事实，默认更偏通用规则而非单组件特化
- `fc:ui:audit` 会加载 `figma-cache/adapters/recipes/`（前10类高频组件库），仅做可选命中与建议，不做全局强制绑定
- `fc:ui:gate`：`verify:static` → `fc:ui:preflight` → `fc:ui:audit`（默认阈值 `85`）→ `fc:validate` → `test:node`（规则守卫 + 单测 + smoke；不重复跑静态校验）
- `fc:ui:report:aggregate` 会聚合 preflight + audit 报告，输出 `figma-cache/reports/ui-quality-summary.json`
- `fc:ui:accept` 是一键自动验收：自动跑 preflight + audit + aggregate，并按效果阈值直接返回 pass/fail（退出码）
- CI 建议矩阵：`fc:ui:gate:pr`（PR 最低门槛）与 `fc:ui:gate:main`（主干严格门槛）
- `fc:ui:e2e:cross` 现默认启用“真实组件链路保护”：`--target` 不存在或验收出现 `code-level comparison skipped` 会直接失败，避免“未绑定真实组件但通过”的假阳性；如需兼容历史流程可显式传 `--allow-skipped-code-level-comparison`

UI profile 分层（P3）：

- `FIGMA_UI_PROFILE=fast|standard|strict`（默认 `standard`）
- `fast`：低门槛快速反馈（audit 默认阈值 70）
- `standard`：团队默认（audit 默认阈值 85）
- `strict`：preflight warning 视为阻断，audit 默认阈值 92 且要求 `--target`

严格证据模式（默认开启）：

- 当 `source=figma-mcp` 时，`upsert/ensure` 会先校验 `mcp-raw` 证据映射
- 仅在你明确需要先落索引骨架时，才使用 `--allow-skeleton-with-figma-mcp`
- `validate` 会校验 `coverageSummary.evidence`，缺失或 TODO 占位会失败

---

## git 用户（仓库开发）

### 1) 克隆并安装依赖

```bash
git clone https://github.com/907086379/figma-to-code-pipeline.git
cd figma-to-code-pipeline
npm ci
```

### 2) 本地自检

```bash
npm run verify:docs
npm test
```

### 3) 提交前建议

- 确认 `README.md`、`figma-cache/docs/*.md` 编码为 UTF-8 无 BOM
- 变更 CLI 行为后，同步更新文档与示例命令
- 只提交与本次任务相关文件

---

## 文档入口

- `figma-cache/docs/README.md`：完整脚本、环境变量、回填与维护说明
- `figma-cache/docs/colleague-guide-zh.md`：团队协作指南与提示词模板
- `figma-cache/docs/quick-start-zh.md`：一页式同事速查卡（3 分钟上手）
- `figma-cache/docs/link-normalization-spec.md`：链接标准化规范
- `figma-cache/docs/flow-edge-taxonomy.md`：流程边类型约定
- `AGENT-SETUP-PROMPT.md`：项目接入任务书（`cursor init` 会刷新）
- `docs/mobile-native-adapter-template.md`：iOS/Android 双端适配模板与最小转换脚本说明
