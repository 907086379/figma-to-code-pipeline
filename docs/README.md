# 人读文档总览（`docs/`）

本目录面向**打开本仓库或接入包的业务同事**：补充根目录 `README.md` 与 **`figma-cache/docs/README.md`**（npm 随包分发的技术手册）之外的**流程约定**与**扩展说明**。

| 文件 | 用途 |
|------|------|
| **README.md**（本文件） | Cursor 治理、推荐工作流、移动端规格、与 `figma-flow-readme.md` 的配合方式 |
| **figma-flow-readme.md** | 由 `figma-cache.config.js` / 示例里的 **`postEnsure`** 按 **`FIGMA_CACHE_FLOW_README`**（默认 `docs/figma-flow-readme.md`）**增量维护**；人类手填「流程总览 / 交互边界」，节点登记区由钩子幂等追加 |

---

## 1. 当前推荐工作流（与 `figma-to-code-pipeline` 3.x 一致）

1. **安装**：`npm i -D figma-to-code-pipeline`（CLI 命令仍为 **`figma-cache`**）。
2. **Cursor 模板与任务书**：`npx figma-cache cursor init`（默认安全模式；覆盖用 `--overwrite`）。
3. **本地缓存索引**：`npm run fc:init`（无 script 时用 `npx figma-cache init`）。
4. **日常证据链**：**先查缓存** → 按需 MCP → 原始回包写入 **`mcp-raw/`** → **`fc:upsert` / `fc:ensure`** → **`fc:validate`** 闭环。`source=figma-mcp` 时证据不完整会被门禁拦截，不能仅靠骨架宣称成功。
5. **默认 completeness**：`layout,text,tokens,interactions,states,accessibility`；`flow` / `assets` 按需；`flow` 自动追加仅白名单关键词或多链接明确串联意图时触发（详见根 `README.md`）。
6. **流程关系**：用 **`fc:flow:*`** 维护 `index.json` 中的 `flows`；评审用图可把 **`npm run fc:flow:mermaid -- --flow=<flowId>`** 输出贴入 **`figma-flow-readme.md`** 的 mermaid 区。
7. **更细命令与环境变量**：始终以 **`figma-cache/docs/README.md`** 为准。

---

## 2. Cursor 本地治理（托管层 / 本地层）

**目标**：避免 `.cursor` 里 bootstrap 托管文件与业务项目私有规则混写、不可追踪。

### 2.1 文件分层

- **托管层**（由包内 `cursor-bootstrap` 同步）
  - 真源：`cursor-bootstrap/` 下 rules、skills 等（本仓库开发时只改这里）。
  - 镜像：`.cursor/rules/*`、`.cursor/skills/*`。
  - 同步：`npm run verify:cursor:sync`；校验：`npm run verify:cursor`（`npm test` / `prepack` 已包含）。

- **本地层**（仅业务仓私有）
  - 规则：`.cursor/rules/local-*.mdc`
  - 技能：`.cursor/skills/local-*/SKILL.md`
  - 不回写到 `cursor-bootstrap`。

### 2.2 命名

- 托管规则保留 **`00`～`04`** 等序号文件名，与 `sync-cursor-shadow` / `managed-files.json` 约定一致。
- 本地规则**禁止**占用同序号与同名托管文件；统一 **`local-*`** 前缀，并在文中标明「适用范围：本项目本地规则」。

### 2.3 变更流程

1. 改托管内容：只动 **`cursor-bootstrap/*`** → `verify:cursor:sync` → `verify:cursor`。
2. 改本地内容：只动 **`local-*`**，不覆盖托管同名文件。

### 2.4 冲突处理

优先级建议：**本地安全类 `local-*`** → 其他项目定制 → **bootstrap 托管**。原则上不删托管规则；更严约束放在 **`local-*`** 收窄范围，并记录冲突点、口径与回滚方式。

### 2.5 可选本地强化示例（业务仓）

- `local-command-execution-safety.mdc`：如 PowerShell 与链式命令、UTF-8 无 BOM 等。
- `local-command-execution-anti-regression.mdc`：沉淀失败案例与安全写法。
- `local-commit-conventions.mdc`：提交信息约定等。

---

## 3. 流程与节点登记（`figma-flow-readme.md`）

- **默认路径**：环境变量 **`FIGMA_CACHE_FLOW_README`** 未设置时，示例配置使用项目根下 **`docs/figma-flow-readme.md`**。
- **手填**：用户路径、分支条件、异常/空状态、粘贴 **`fc:flow:mermaid`** 输出到 mermaid 代码块。
- **自动**：`postEnsure` 对每个**新** `cacheKey` 在「已从 Figma 写入缓存的节点」区域幂等追加一节；**像素级事实**仍以各节点 **`spec.md` / `raw.json`** 为准。
- 本仓库内的 **`docs/figma-flow-readme.md`** 仅保留**空骨架示例**；真实项目里该文件会随 ensure 增长，可纳入版本库供评审。

---

## 4. 移动端规格（iOS / Android，可选）

在节点已进入本地缓存（`fc:get` / `fc:upsert` 等）的前提下，可将通用缓存整理为统一 **`mobile-spec.json`**，供 SwiftUI / Compose 等分别映射（本阶段**不**直接生成 Swift/Kotlin UI 代码）。

### 4.1 建议目录（业务项目）

```text
figma-cache/
  index.json
  files/
mobile-adapter/
  field-mapping.template.json   # 包内可参考 scripts/mobile/field-mapping.template.json
  ios/
  android/
```

### 4.2 命令

```bash
npm run fc:mobile:spec -- --url "<figma-url>" --platform all
```

- **`--url`**：须与 `index.json` 中该项的 URL 一致。
- **`--platform`**：`ios` | `android` | `all`（默认 `all`）。
- **`--out-dir`**：可选，默认 `figma-cache/mobile-specs`。

### 4.3 产物说明

输出默认：`figma-cache/mobile-specs/<cacheKey>/mobile-spec.json`，一般包含：

- `source`：来源、同步时间、完整度、缺失维度。
- `normalized`：从 `spec.md` 与 `raw.json` 汇总的六大维度文本。
- `platforms.ios` / `platforms.android`：平台实现关注点与风险提示。
- `todoWarnings`：TODO / 待补充提醒，避免误当 1:1 已完成。

### 4.4 落地建议

- **iOS**：tokens → Design Token（Color/Font/Spacing），UI 由 SwiftUI 组件库承接。
- **Android**：tokens → Compose Theme 或 XML 资源。
- **交互与状态**：优先状态机 / Reducer，避免散落在视图。
- **无障碍**：落到 VoiceOver / TalkBack、焦点顺序、语义标签等验收项。

### 4.5 边界与阶段

- `coverageSummary.missing` 含 `interactions` / `states` / `accessibility` / `flow` / `assets` 时，按**受限还原**处理，不强行当完整规格。
- **阶段决策（与历史模板一致）**：当前优先把 Web 方案跑稳；原生侧深度代码生成与模板扩展待 Web 稳定后再评估。

---

## 5. 更多入口

- **`figma-cache/docs/README.md`**：脚本全集、环境变量、Adapter、`postEnsure`、门禁与 UI 工具链。
- **`figma-cache/docs/colleague-guide-zh.md`**：团队向长文与提示词模板。
- **`figma-cache/docs/quick-start-zh.md`**：新人速查。
- **`AGENT-SETUP-PROMPT.md`**：接入任务书（`cursor init` 会刷新到业务项目根）。
