# figma-to-code-pipeline

`figma-to-code-pipeline` 面向业务项目，专注 **Figma → 本地通用缓存** 这一中间数据层，为后续设计与代码协同提供可校验、可复用的基础。默认采用「本地缓存优先 + 按需 MCP + 最小调用集 + 严格证据校验 + validate 闭环」；**不绑定具体 UI 框架**。

- npm 包：`figma-to-code-pipeline` · 命令行：`npx figma-cache …`（`bin` 名为 **`figma-cache`**）
- Git：<https://github.com/907086379/figma-to-code-pipeline.git>

**面向**：npm 接入的业务仓日常使用；克隆本仓库的开发者维护 CLI / 文档 / `cursor-bootstrap`。

> npm 发布由仓库维护者负责；普通用户无需执行 `npm publish`。

---

## npm 用户快速开始

```bash
npm i -D figma-to-code-pipeline
npx figma-cache cursor init    # 默认安全模式；覆盖模板用 --overwrite
npm run fc:init                 # 无 scripts 时用：npx figma-cache init
npm run fc:validate
```

接入后请在 Cursor 中 **`@AGENT-SETUP-PROMPT.md`**（由 `cursor init` 刷新）。`cursor init` 还会落地 `figma-cache.config.js`、`AGENT-SETUP-PROMPT.md`，并把同事指南拷到 **`figma-cache/docs/colleague-guide-zh.md`**。

**协作口径（极简）**：先查缓存 → 按需 MCP → **`mcp-raw/`** 落证据 → **`fc:upsert` / `fc:ensure`** → **`fc:validate`**。`source=figma-mcp` 时证据不全会失败，不能仅靠骨架宣称成功。提示词与日常约定见 **`figma-cache/docs/colleague-guide-zh.md`**。

**脚本全集、环境变量、`flow`、UI gate、预算、示例命令**：见 **`figma-cache/docs/README.md`**（随 npm 包分发的主手册）。

---

## 本仓库维护者（`cursor-bootstrap` / CI）

> **业务项目**一般只需上面的 `cursor init`，**不需要**跑 sync。

- 真源：`cursor-bootstrap/`；镜像：`.cursor/`（勿手改镜像）
- 改规则后：`npm run verify:cursor:sync` → `npm run verify:cursor`（`npm test` / `prepack` 已包含）

---

## 克隆本仓库

```bash
git clone https://github.com/907086379/figma-to-code-pipeline.git
cd figma-to-code-pipeline
npm ci
npm run verify:docs && npm test
```

提交前：`README.md`、`docs/*.md`、`figma-cache/docs/*.md` 保持 **UTF-8 无 BOM**；改 CLI 请同步 **`figma-cache/docs/README.md`** / **`CHANGELOG.md`**。

---

## 文档入口

| 场景 | 文件 |
|------|------|
| 升级 / 破坏性变更 | `CHANGELOG.md` |
| 命令、环境变量、流程、UI 工具链（主手册） | `figma-cache/docs/README.md` |
| 团队长文与提示词模板 | `figma-cache/docs/colleague-guide-zh.md` |
| 新人 3 分钟 | `figma-cache/docs/quick-start-zh.md` |
| 链接 / flow 边类型规范 | `figma-cache/docs/link-normalization-spec.md`、`flow-edge-taxonomy.md` |
| 接入任务书 | `AGENT-SETUP-PROMPT.md`（`cursor init` 刷新到业务根） |
| 人读总览（治理、`figma-flow-readme`、移动端可选） | `docs/README.md`、`docs/figma-flow-readme.md` |
| 跨仓 `fc:ui:e2e:cross` 编排 | `UI-E2E-AUTOMATION-WORKFLOW.md` |
