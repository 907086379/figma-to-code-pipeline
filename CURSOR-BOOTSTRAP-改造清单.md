# Cursor Bootstrap 改造清单（按步骤执行）

目标：降低配置复杂度，避免 .cursor 冲突，并提升 Agent 一次性 1:1 还原成功率。

## 先回答你的 3 个问题（结论）

### 1) `skills` 为什么每个 skill 要嵌套目录？是否能简化

结论：目录嵌套是 Cursor Skill 的约定结构（`skills/<skill-name>/SKILL.md`），建议保留目录形态，不改成平铺。

可以简化的不是“目录层级”，而是“技能数量与职责重叠”：
- 保留 2 个核心 skill：
  - `figma-mcp-local-cache`
  - `figma-ui-dual-mode-execution`
- 将 `ui-baseline-governance` 并入 adapter 规则或主 skill（若团队确实很少单独调用它）。
- 原则：一个 skill 只做一个阶段（缓存 / UI），不要重复写相同约束。

---

### 2) `rules` 前面的序号是必须吗？

结论：在本项目当前实现里，序号不是 Cursor 强制要求，但对你这个仓库是“工具链约定”，暂时不建议去掉。

原因：
- `cursor-bootstrap-cli.js` 和 `scripts/sync-cursor-shadow.js` 里写死了这些文件名。
- 直接去序号会引发 `cursor init / sync / check` 漂移。

可做的简化：
- 保留 bootstrap 托管规则的序号（稳定兼容）。
- 本项目自定义规则统一用 `local-*.mdc`（无序号），避免和托管规则混在一起。

---

### 3) `.cursor` 里“本地规则 + bootstrap 同步规则”会不会冲突？如何管理

结论：会冲突，尤其在“同主题双规则”时。需要做“托管区 / 本地区”分层治理。

推荐管理法：
- 托管区（由 `cursor-bootstrap` 同步）：
  - `.cursor/rules/00-output-token-budget.mdc`
  - `.cursor/rules/01-figma-cache-core.mdc`
  - `.cursor/rules/02-figma-*-adapter.mdc`（最终栈规则）
  - `.cursor/rules/03-figma-ui-implementation-hard-constraints.mdc`
  - `.cursor/rules/04-ui-baseline-governance.mdc`（若保留）
- 本地区（项目私有）：
  - `.cursor/rules/local-*.mdc`
  - `.cursor/skills/local-*/SKILL.md`
- 禁止本地文件覆盖托管同名文件。

---

## 分步落地方案（一步一步执行）

## 第 0 步：先冻结当前状态（可回滚）

执行：
- 新建分支：`chore/cursor-governance-refactor`
- 记录当前规则与技能清单（用于对比）

验收：
- `git status` 仅包含你预期变更。

回滚：
- 直接切回原分支。

---

## 第 1 步：定义“托管文件白名单”

动作：
- 新建 `cursor-bootstrap/managed-files.json`。
- 内容写明由 bootstrap 托管的 rules/skills 文件路径。

目的：
- 后续 `sync/check` 统一读这个清单，避免“同步一套、校验另一套”。

验收：
- 清单覆盖当前真正同步的所有文件（尤其 03/04 规则和 3 个 skills）。

回滚：
- 删除该 json 并恢复脚本原逻辑。

---

## 第 2 步：修复 shadow 检查漂移

动作：
- 改 `scripts/check-cursor-shadow.js`：
  - 不再手写部分 pair。
  - 改为读取 `cursor-bootstrap/managed-files.json`。
- 保证 `sync` 与 `check` 用同一份清单。

验收：
- `npm run verify:cursor:sync`
- `npm run verify:cursor`
- 两者都通过。

回滚：
- 恢复 `check` 旧版本即可。

---

## 第 3 步：技能简化（不改目录结构，只减数量）

动作：
- 评估 `ui-baseline-governance` 是否独立保留：
  - 若很少单独调用：合并到 `figma-ui-dual-mode-execution` 并删除该 skill。
  - 若常单独调用：保留。
- 清理重复口径（例如标签限制、状态覆盖规则）到单一来源。

验收：
- `.cursor/skills` 下不出现语义重复技能。
- `cursor-bootstrap/skills` 与 `.cursor/skills` 同步后无漂移。

回滚：
- 恢复被删除 skill 目录。

---

## 第 4 步：规则分层收敛（减少互相打架）

动作：
- 将以下规则口径整合，避免冲突：
  - `03-figma-ui-implementation-hard-constraints.mdc`
  - `03-one-shot-ui-restoration.mdc`（建议并入 03）
  - `03-ui-implementation-evidence.mdc`（建议并入 03）
- 保留“信息充分 -> 一次性交付；信息不足 -> 明确缺口”的单一判定逻辑。

验收：
- 03 规则成为 UI 实现唯一主规则（避免同阶段多规则冲突）。

回滚：
- 恢复拆分版 03 规则。

---

## 第 5 步：建立本地规则命名规范

动作：
- 本地与人读约定已并入 **`docs/README.md`**（原 `docs/cursor-local-governance.md` / `docs/mobile-native-adapter-template.md` 内容合并）。
- 明确：
  - 托管规则只在 `cursor-bootstrap` 手写。
  - `.cursor` 是镜像，不手改。
  - 本地自定义统一 `local-*.mdc`，禁止使用 `00~04` 序号段。

验收：
- 团队成员新增规则时有统一入口，不会再和托管规则冲突。

回滚：
- 无需回滚（文档增量）。

---

## 第 6 步：调整 `cursor init` 默认行为（降低覆盖风险）

动作：
- 调整 `figma-cache/js/cursor-bootstrap-cli.js`：
  - 默认“存在即跳过”（安全模式）。
  - `--overwrite` 才覆盖现有文件。
- 同步更新 `README` 与 `AGENT-SETUP-PROMPT.md` 文案。

验收：
- 重复执行 `npx figma-cache cursor init` 不会覆盖你本地定制。

回滚：
- 改回当前覆盖策略。

---

## 第 7 步：加一条一次性 1:1 验收命令（关键）

动作：
- 增加组合脚本，例如：
  - `fc:ui:gate` = `fc:validate + lint + (typecheck 或核心测试)`
- 让 Agent 在“宣称完成 1:1”前必须跑该门禁。

验收：
- 任何一次交付都可通过同一条命令复验。

回滚：
- 保留旧流程即可，不影响主功能。

---

## 建议执行顺序（最小风险）

1. 第 1 步（托管清单）
2. 第 2 步（sync/check 对齐）
3. 第 5 步（本地命名规范）
4. 第 3 步（技能减量）
5. 第 4 步（03 规则合并）
6. 第 6 步（init 覆盖策略）
7. 第 7 步（1:1 门禁脚本）

---

## 你现在可以直接开始的第一步

先做第 1 步 + 第 2 步。这两步完成后，配置治理就不会再“同步一套、校验一套”，是后续所有简化的基础。

---

## 执行进度日志

- 2026-04-16 第 1 步完成：已新增 `cursor-bootstrap/managed-files.json`，明确 bootstrap 托管 rules/skills 白名单。
- 2026-04-16 第 2 步完成：已改造 `scripts/sync-cursor-shadow.js` 与 `scripts/check-cursor-shadow.js`，统一读取 `cursor-bootstrap/managed-files.json`。
- 2026-04-16 验收通过：`npm run verify:cursor:sync` 与 `npm run verify:cursor` 均通过。
- 2026-04-16 故障沉淀：已将 PowerShell `&&` 与 UTF-8 BOM 导致 Node 脚本/JSON 解析失败案例追加到 `.cursor/rules/local-command-execution-anti-regression.mdc`。

---

## 新增专项：PowerShell 与 BOM 防错（已落地）

### A. 本地规则固化（已完成）
- 新增：`.cursor/rules/local-command-execution-safety.mdc`
- 覆盖问题：
  - PowerShell 禁止使用 `&&`；顺序命令统一使用 `;`
  - `.js/.json/.mdc` 写入统一 UTF-8 无 BOM
- 长期安全写法：
  - `[System.IO.File]::WriteAllText(path, content, (New-Object System.Text.UTF8Encoding($false)))`

### B. 清单要求（新增）
- 以后凡命中命令执行语法或编码问题：
  1. 先修复并复跑命令；
  2. 在本清单追加“故障 -> 修复 -> 验证结果”；
  3. 在最终交付中明确长期安全写法。

---

## 执行进度日志（续）

- 2026-04-16 专项完成：已新增本地规则 `.cursor/rules/local-command-execution-safety.mdc`，固化 PowerShell 与 BOM 防错。
- 2026-04-16 第 5 步完成：已明确托管层/本地层边界与命名规范（现统一见 **`docs/README.md`** 第 2 节）。

---

## 执行进度日志（终局）

- 2026-04-16 第 3 步完成：已将 `ui-baseline-governance` skill 并入 `figma-ui-dual-mode-execution`；托管清单已移除该 skill；`.cursor/skills/ui-baseline-governance/SKILL.md` 已移除。
- 2026-04-16 第 4 步完成：`03-figma-ui-implementation-hard-constraints.mdc` 已合并 one-shot 与 evidence 口径；删除 `.cursor/rules/03-one-shot-ui-restoration.mdc`、`.cursor/rules/03-ui-implementation-evidence.mdc`。
- 2026-04-16 第 6 步完成：`cursor init` 默认切换为安全模式（保留已有模板），新增 `--overwrite` 显式覆盖，`--force` 保持兼容旧语义（保留不覆盖）；CLI、README、docs、CHANGELOG、release notes、smoke 测试已同步。
- 2026-04-16 第 7 步完成：已新增 `package.json` 脚本 `fc:ui:gate`，串联 `fc:validate + verify:cursor + npm test` 作为“一次性 1:1 交付门禁”。
- 2026-04-16 全量验收通过：`verify:cursor:sync/check`、`verify:docs`、`npm test` 均通过。
- 2026-04-16 第 0 步完成：已创建改造分支 `chore/cursor-governance-refactor`，用于冻结基线与可回滚执行。
- 2026-04-16 Review补修完成：已修复 `--force` 兼容语义（保持旧行为：保留不覆盖），新增 `--overwrite` 覆盖模式互斥校验；并在 `managed-files.json` 增加 `retiredFiles`，`sync/check/cursor init` 已支持退役镜像清理与残留检测。
- 2026-04-16 Review补修验收：新增 smoke 用例覆盖 `--force` 兼容、`--overwrite`、参数冲突报错、retired 文件自动清理；全链路 `verify:cursor:sync/check + npm test` 通过。

- 2026-04-16 极致清晰收口完成：本地规则已统一 `local-*` 命名，`04-command-execution-anti-regression.mdc` -> `local-command-execution-anti-regression.mdc`，`commit-conventions.mdc` -> `local-commit-conventions.mdc`；旧路径已加入 `retiredFiles` 清理。
