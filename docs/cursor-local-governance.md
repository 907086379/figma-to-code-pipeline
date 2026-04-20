# Cursor 本地治理约定

目标：避免 `.cursor` 托管文件与本地项目自定义规则冲突，确保规则可追踪、可回滚、可同步。

## 1. 文件分层

- 托管层（bootstrap 管理）
  - 来源：`cursor-bootstrap/*`
  - 镜像：`.cursor/rules/*`、`.cursor/skills/*`
  - 同步入口：`npm run verify:cursor:sync`
  - 校验入口：`npm run verify:cursor`

- 本地层（项目私有）
  - 规则命名：`.cursor/rules/local-*.mdc`
  - 技能命名：`.cursor/skills/local-*/SKILL.md`
  - 用途：仅承载本项目特有约束，不回写到 `cursor-bootstrap`

## 2. 命名规范

- 托管规则保留现有序号命名（如 `00~04`），保证工具链兼容。
- 本地规则禁止占用 `00~04` 序号段，统一 `local-*` 前缀。
- 本地规则描述必须写明“适用范围：本项目本地规则”。

## 3. 变更流程（强制）

1) 改托管规则：
- 仅修改 `cursor-bootstrap/*`
- 执行 `npm run verify:cursor:sync`
- 执行 `npm run verify:cursor`

2) 改本地规则：
- 仅修改 `.cursor/rules/local-*.mdc` 或 `.cursor/skills/local-*`
- 不得覆盖托管同名文件
- 改造清单追加“本地变更日志”

## 4. 冲突处理

出现同主题冲突时按优先级处理：
1. 本地安全规则（`local-*`）
2. 项目定制规则（非 bootstrap 镜像）
3. bootstrap 托管规则

处理原则：
- 不删除托管规则，优先在 `local-*` 中做更窄范围约束。
- 必须记录冲突点、采用口径、回滚方式。

## 5. 当前本地强化项

- `local-command-execution-safety.mdc`
  - 目的：防止 PowerShell `&&` 与 UTF-8 BOM 导致命令或脚本执行失败。
- `local-command-execution-anti-regression.mdc`
  - 目的：沉淀命令执行失败案例并强制采用长期安全替代写法。
- `local-commit-conventions.mdc`
  - 目的：统一提交文案结构（Conventional Commit + 中文结果导向）。