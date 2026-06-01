# figma-to-code-pipeline -> textr-web-v2 兼容改造清单（上游）

> 目标：把对 `textr-web-v2` 的关键兼容能力沉淀到上游默认行为，降低每个业务仓重复适配成本。  
> 本文为**目标仓执行清单**（上游增强）。下游落地清单见业务仓 `migration/shared/FIGMA-DUAL-REPO-ADAPTATION-TASKLIST.md`。

## 1) 改造目标

- 提供可配置的栈画像（profile），减少“默认模板不匹配”问题。
- 默认避免把 batch 产物写进 `src/pages/**`（尤其 auto-routes 项目）。
- 挂载页支持自动探测与安全回退。
- 给出可机器执行的适配诊断结果（doctor/report）。

## 2) 交付物（必须产出）

- [x] `cursor-bootstrap/examples/` 新增面向 Vue3 + Vite + auto-routes 的 batch config 模板
- [x] `scripts/batch-add.cjs` 增强：支持 profile 优先级与更稳妥默认 targetRoot
- [x] 新增 `scripts/doctor/`（或等价）适配诊断脚本
- [x] `figma-cache/docs/README.md` 与 `docs/README.md` 补齐兼容章节
- [x] 若有命令入口：`package.json` 新增 `fc:doctor`（或文档指定等价命令）

## 3) 任务拆解（按顺序）

### A. 配置层兼容增强

- [x] 设计 `uiBatch.profile` 机制（示例：`vue3-vite-auto-routes-tailwind`）
- [x] profile 生效顺序定义：CLI 参数 > 环境变量 > 项目配置 > 默认
- [x] 为 profile 提供默认 `targetRoot/targetTemplate/mountMode` 组合（`mountPage` 仅 `auto` 时需要）

### B. 默认路径安全化

- [x] 调整默认 `targetRoot` 到非路由目录（例如 `./src/components/figma-batch`）
- [x] 保留向后兼容（旧配置显式指定时不强改）
- [x] 对 `src/pages/main/**` 旧默认给出 deprecate 提示（非破坏）

### C. mount 页面探测

- [x] 挂载模式支持 `auto|manual|off`（默认 `manual`）
- [x] 若 `mountMode=auto` 且 `mountPage` 缺失，自动探测候选页（可配置优先级）
- [x] 探测失败时提供建议修复路径与示例文件
- [x] `mount` 仅为 batch 元数据；默认 `manual` 不改页面（已移除 `ui-mount-batch`）

### D. doctor 诊断能力

- [x] 新增诊断命令，输出 JSON/文本摘要（路由模式、目标目录风险、挂载页可用性、建议 patch）
- [x] 诊断结果可用于 Agent 自动决策（机器可读字段）
- [x] 文档化常见风险场景（auto-routes、monorepo、Windows URL `&`）

### E. 文档与模板收口

- [x] 更新 `figma-cache/docs/README.md`（新增“Vue3 auto-routes 推荐配置”）
- [x] 更新 `docs/README.md`（新增 doctor 与 profile 入口）
- [x] 在 `cursor-bootstrap/examples` 补充 `textr-web-v2` 风格模板

## 4) 验收标准（DoD）

- [x] 新仓仅执行 `cursor init + 最少配置` 即可避免写入 `src/pages/main/**`
- [x] `batch-add` 在未显式 target 时，默认产物路径对 auto-routes 安全
- [x] `fc:doctor` 能正确识别至少 2 类项目（auto-routes / 普通路由）（实现：`detectRouteMode`；业务仓实测建议保留）
- [x] 文档可直接指导业务仓完成接入，无需口头补充
- [x] 现有用户配置不回归（兼容旧参数）

## 5) 回归矩阵（最小）

- [ ] Vue3 + vite + vue-router/auto-routes（目标场景，需在业务仓实测）
- [ ] Vue3 + 手写 router（兼容场景，需在业务仓实测）
- [ ] React 项目（确保未被 Vue 特化逻辑误伤，需在业务仓实测）
- [x] Windows PowerShell（含 URL `&m=dev`）（文档已说明；CLI 无新增 shell 依赖）
- [x] 单元测试：`tests/ui-batch-mount.test.js`

## 6) 实现备注

- 共享模块：`scripts/ui/ui-batch-mount.cjs`（profile / mountMode / 探测 / deprecate / `buildUiBatchDoctorReport`）
- batch case 可选字段：`toolchain.profile`（与 `naming.profile` 同步）
- `npm run fc:doctor -- --strict`：仅 **blocking findings** 退出码 2；`missing-ui-batch-config` 为 advisory
- `batch-add`：`manual/off` 时 `upsertCaseV2` 会 `delete` 残留 `mount`；更新已有 case 且未显式 `--target`/`--target-root` 时保留 `target.entry`
- 未知 `mountMode` 字符串归 `manual`（非 `auto`）

## F. Agent 运行时门禁（4.4+）

- [x] `figma-cache project-setup <init|status|finish>` + `project-setup.manifest.json`
- [x] `validate --strict-project` / `--hygiene`；ingest `--require-project-setup`
- [x] `fc:mcp:ingest:url`、`fc:mcp:batch:cache`、`agent-runtime-hygiene-gate`
- [x] `docs/AGENT-RUNTIME-GUARDRAILS.md`；`cursor init` 尊重 `complete` + ESM `.cjs` 配置模板

## 7) 与下游联动说明

- 上游完成后，回到业务仓执行：`migration/shared/FIGMA-DUAL-REPO-ADAPTATION-TASKLIST.md`。
- 若两仓并行改造，先合并上游默认策略，再在下游去掉临时覆盖项，避免重复配置。
