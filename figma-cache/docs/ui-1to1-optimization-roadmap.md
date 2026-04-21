# UI 1:1 还原优化路线图（P0-P3）

> 目标：让 Agent 生成的组件/页面尽可能一次性 1:1 还原，显著降低返工轮次。

---

## 0. 北极星目标与衡量指标

## 0.1 北极星目标

- **一次性交付可用率**：目标从当前基线提升到 `>=85%`（P2 结束）并冲刺 `>=95%`（P3）
- **平均返工轮次**：降到 `<=1.0`（P2）
- **关键页面首轮通过率**：`>=90%`（P3）

## 0.2 指标定义（统一口径）

- `firstPassAccepted`: 首轮无需视觉/交互修改即可验收
- `reworkRounds`: 从首次生成到验收的修改轮次
- `score.layout/text/token/state/interaction`: 五维质量得分（0-100）
- `blockingRate`: preflight 阻断率（要区分“真实阻断”与“误报阻断”）

---

## 1. P0（当前）：开工前门禁与可观测性

## 1.1 目标

- 新增 `fc:ui:preflight`，先判断“是否具备开工条件”，减少无效生成。
- 在 `fc:ui:gate` 中前置 preflight。

## 1.2 交付物

- `scripts/ui/ui-preflight.js`
- `figma-cache/reports/ui-preflight-report.json`
- `package.json`：`fc:ui:preflight` + 更新 `fc:ui:gate`
- `tests/smoke.js`：preflight 正负样例

## 1.3 完成判定

- preflight 对缺失证据/缺失 contract/覆盖证据空维度能稳定阻断（exit 2）
- gate 能在 preflight blocking 时提前失败

---

## 2. P1：结果可度量（从“过程正确”到“结果可验”）

## 2.1 目标

- 建立统一评分与差异报告，明确“还差多少才 1:1”。

## 2.2 交付物（建议）

1. **质量审计脚本**
   - 新增：`scripts/ui/ui-1to1-audit.js`
   - 输入：`cacheKey`、目标组件路径、可选 contract
   - 输出：`figma-cache/reports/ui-1to1-report.json`

2. **报告规范（schema）**
   - 新增：`figma-cache/docs/ui-1to1-report.schema.json`
   - 字段至少包含：
     - `score.total`
     - `score.layout/text/token/state/interaction`
     - `diffs[]`（事实差异项）
     - `blocking[]`、`warnings[]`

3. **gate 接入阈值**
   - 新增 script：`fc:ui:audit`
   - 更新 gate：加入审计阈值（如 `score.total >= 85` 才放行）

## 2.3 技术策略

- 先做“事实对事实”比对（cache 事实 vs 代码事实），避免一上来就纯像素比对。
- 文本、token、状态覆盖优先，布局分阶段细化（先主轴、后细节）。

## 2.4 完成判定

- 每次生成后都可产出结构化评分报告
- 失败有明确差异清单，不再依赖人工口头描述

---

## 3. P2：生成准确性强化（减少二次修改）

## 3.1 目标

- 将“映射与规则”从提示词级别，提升为可执行资产，降低 Agent 自由发挥空间。

## 3.2 交付物（建议）

1. **设计事实标准化层**
   - 新增：`figma-cache/js/ui-facts-normalizer.js`
   - 职责：把 `spec/raw/state-map/mcp-raw` 统一成稳定事实模型（dimensions/states/tokens/interactions）

2. **组件生成配方（recipe）机制**
   - 新增目录：`figma-cache/adapters/recipes/`
   - 每类组件（select/input/modal/table）定义：
     - 结构模板
     - 状态机模板
     - token 映射优先级
     - 常见陷阱修正

3. **contract 增强（从静态映射到约束映射）**
   - 扩展 `ui-adapter.contract.json`：
     - `layoutRules`
     - `typographyRules`
     - `interactionRules`
   - 并增强 `contract-check`：新增规则级校验（非仅 token/state）

4. **节点级 override 正规化**
   - 规范 `ui-override.json` 字段与优先级
   - 增加冲突检测（global contract vs node override）

## 3.3 完成判定

- 常见组件类型（前 10 类）首轮通过率显著提升
- 同一组件跨页面表现一致（规则资产复用）

---

## 4. P3：体系化与规模化（团队长期稳定）

## 4.1 目标

- 让流程可治理、可追踪、可持续优化。

## 4.2 交付物（建议）

1. **模式分层（降低认知负担）**
   - 引入 `FIGMA_UI_PROFILE=fast|standard|strict`
   - profile 映射到：preflight 严格度、审计阈值、是否强制预检文档

2. **报告汇总与趋势分析**
   - 新增：`scripts/ui/ui-report-aggregate.js`
   - 汇总 `ui-preflight-report.json` + `ui-1to1-report.json`，输出周报/趋势

3. **CI 质量门禁矩阵**
   - PR 最低门槛：preflight 必过
   - 主干门槛：audit 分数阈值
   - 关键路径页面：视觉基线对比（可选）

4. **最佳实践模板化**
   - 在 `cursor-bootstrap` 增加短版/严格版执行模板
   - 把高频问题沉淀为“自动检查而非口头提醒”

## 4.3 完成判定

- 指标长期稳定（首轮通过率、返工轮次）
- 新成员可按模板快速落地，不依赖专家经验

---

## 5. 建议实施顺序（现实可执行）

1. **先做 P0（当前）**：先拦截无效开工
2. **紧接 P1**：先拿到评分与差异报告
3. **再做 P2**：把高频返工点产品化（recipe + contract 增强）
4. **最后 P3**：标准化与团队化治理

---

## 6. 每阶段建议工期（参考）

- P0：1~2 天
- P1：3~5 天
- P2：1~2 周（按组件类型分批）
- P3：持续迭代（每周治理）

---

## 7. 与现有文档关系

- P0 详细执行：`figma-cache/docs/p0-ui-preflight-handoff.md`
- 本文档：总路线图（P0-P3）

---

## 8. 当前实现进度（2026-04）

- P0：已完成（preflight + gate 前置 + smoke + 文档）
- P1：已完成（audit + schema + gate 阈值）
- P2：已完成第一批（facts normalizer、recipes、contract 规则增强、override 冲突检测）
- P3：已完成第一批（profile 分层、报告聚合、PR/main 门禁矩阵、执行模板）
