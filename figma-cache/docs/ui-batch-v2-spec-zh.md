# UI 批量接口基线（v2）：DesignRef / TargetSpec / MountSpec / AuditSpec

本文件定义 **`figma-e2e-batch.json` v2** 的**唯一权威接口**，用于把“Figma 设计节点”以批量方式落地到不同目标（Vue / React / HTML）并完成挂载与审计。

重要说明：

- **破坏性更新**：本 v2 与旧格式不兼容；工具链脚本只支持 v2。
- **批量文件名固定**：仍使用 `figma-e2e-batch.json`。
- **目标**：同一套 batch 同时支持多框架 target + 多种 mount 元数据 + 审计模式差异化。
- **落地方式**：端到端由 **Agent/脚本链路** 驱动（非“一键自动改业务页面”）。典型顺序：`fc:mcp:ingest(:quiet)` → `fc:batch:add`（`batch-add.cjs`）→ 按 `target.entry` 生成/修复组件 → `fc:ui:preflight` → `fc:ui:accept` / `fc:ui:accept:batch`。

---

## 0. 端到端流程（Agent 驱动）

| 阶段 | 命令/脚本 | 作用 |
| --- | --- | --- |
| 设计证据 | `fc:mcp:ingest` / `fc:mcp:ingest:quiet` | MCP 三段落盘 + ensure/validate/budget |
| 登记 batch | `fc:batch:add`（`batch-add.cjs`） | 写入/更新 `figma-e2e-batch.json` 的 `designRef` / `target` / `limits` 等 |
| 实现产物 | Agent 按 `target.entry` 写 Vue/React/HTML | **不**默认修改业务路由页 |
| 验收 | `fc:ui:preflight`、`fc:ui:accept`、`fc:ui:gate*` | 对照缓存事实与门禁 |

约定：

- **默认 `mountMode=manual`**：`batch-add` **不**向业务页面做 inject；`mount` 字段通常不写入 batch。
- **`mount` 仅为 batch 元数据**（可选）：描述联调时“希望挂载到哪一页”；实际是否改页面由 Agent 或显式 `mountMode=auto` 策略决定，**无** `ui-mount-batch --all` 一类批量改页命令。
- **更新已有 case**：未显式传 `--target` / `--target-root` 时，`batch-add` **保留** 原 `target.entry`，避免随 profile/模板默认值静默漂移。

---

## 1. 名词与边界

### 1.1 DesignRef（设计引用）

用于定位 Figma 上的“设计真源节点”。

```json
{
  "fileKey": "53hw0wDvgOzH14DXSsnEmE",
  "nodeId": "9277-28654"
}
```

- **fileKey**：Figma 文件标识。
- **nodeId**：节点 id。推荐使用 URL 里的 `9277-28654` 形式（工具链会在需要时转换为 `9277:28654`）。

边界：

- DesignRef 只负责“指向哪里”，不包含任何目标框架信息。

### 1.2 TargetSpec（目标输出）

描述“把设计节点落实到哪里、以什么形式输出”。

```json
{
  "kind": "vue",
  "entry": "./src/components/figma-batch/FigmaNode9277x28654/index.vue",
  "assets": []
}
```

- **kind**：`"vue" | "react" | "html"`
- **entry**：目标入口文件（相对项目根目录的路径）。
  - `kind=vue`：通常是 `.vue` 组件文件（如 `.../index.vue`）
  - `kind=react`：通常是 `.tsx`/`.jsx` 组件文件
  - `kind=html`：通常是一个可注入片段文件（内容可为任意 HTML 字符串；建议不含 `<html>/<body>` 外层）
- **assets（可选）**：目标项目额外资产路径列表（当前 v2 只作为元信息保留；工具链可能用于 future-proof 的复制/审计扩展）。

边界：

- TargetSpec 不负责“挂载到哪里”，只负责“目标产物入口是什么”。

### 1.2.1 ToolchainMeta（工具链元数据，可选）

由 `batch-add` 写入，用于追溯 profile / 模板来源（不参与挂载与审计门禁逻辑）。

```json
{
  "profile": "vue3-vite-auto-routes-tailwind"
}
```

- **profile**：生效的栈画像名（未知 profile 时写入 fallback 后的名称，与 `naming.profile` 一致）。

### 1.2.2 NamingMeta.profile（可选）

`naming.profile` 与 `toolchain.profile` 同步，便于在关系报告里与组件命名一并查看；**以 `toolchain.profile` 为机器读主字段**。

### 1.3 MountSpec（挂载元数据，可选）

描述联调时“若要把 `target.entry` 展示到某预览页”的**意图**；**不**等同于工具链自动修改业务仓库页面。

> `mount` 是**可选**字段。默认 `mountMode=manual` 时 `batch-add` **不**写入 `mount`，也**不**改任何页面文件。

```json
{
  "mountPage": "./src/pages/figma-preview.vue",
  "mode": "inject",
  "marker": "case-0"
}
```

- **mountPage**：建议的预览/联调页路径（相对项目根目录）。
  - 支持：`.vue` / `.tsx` / `.jsx` / `.html`
- **mode（可选，schema 保留）**：
  - `inject`：表示“在 mountPage 中 import 并渲染 `target.entry`”（由 Agent 或 `mountMode=auto` 流程执行，**非**默认批量改页）
  - `iframe`：预留
  - `manual`：显式声明不自动改文件（与全局 `mountMode=manual` 一致）
- **marker（可选）**：HTML 片段联调时区分挂载位（`data-figma-mount`）

边界：

- **验收主路径**以 `target.entry` + `fc:ui:accept` 为准，不依赖页面 inject。
- 历史 `ui-mount-batch` 已移除；请勿在文档或提示词中假设“运行某命令即可 `--all` 注入全 batch”。

### 1.4 AuditSpec（审计策略）

描述“如何对照缓存事实审计目标产物”。

```json
{
  "mode": "web-strict",
  "dimensions": ["layout", "text", "tokens", "interactions", "states", "accessibility"]
}
```

- **mode**：
  - `web-strict`：默认 Web 严格审计（适用于 Vue/React 组件，要求真实 target code 参与对照）
  - `html-partial`：HTML 最小可行审计（仅对照 text / token(hex)；其他维度标记 skipped，不默认失败）
- **dimensions（可选）**：
  - `web-strict` 模式下可用于声明期望覆盖维度（当前主要作为报告展示与 future-proof；实际门禁以工具链实现为准）
  - `html-partial` 模式下通常不需要配置

---

## 2. figma-e2e-batch.json（v2）文件结构

### 2.1 顶层结构

```json
{
  "version": 2,
  "cases": [
    {
      "id": "case-main-9277-28654",
      "designRef": { "fileKey": "53hw0wDvgOzH14DXSsnEmE", "nodeId": "9277-28654" },
      "target": { "kind": "vue", "entry": "./src/components/figma-batch/FigmaNode9277x28654/index.vue" },
      "toolchain": { "profile": "vue3-vite-auto-routes-tailwind" },
      "mount": { "mountPage": "./src/pages/figma-preview.vue", "mode": "inject" },
      "audit": { "mode": "web-strict" },
      "limits": { "minScore": 85, "maxWarnings": 10, "maxDiffs": 10 },
      "policy": { "allowPrimitives": [] }
    }
  ]
}
```

字段说明：

- **version**：固定为 `2`
- **cases**：case 列表（至少 1 个）

每个 case：

- **id（可选）**：稳定标识，推荐可读可追溯。缺省时工具链会用 `case-<index>` 补齐。
- **designRef（必填）**：见上文 DesignRef
- **target（必填）**：见上文 TargetSpec
- **mount（可选）**：见上文 MountSpec
- **audit（可选）**：见上文 AuditSpec
- **limits（可选）**：门禁阈值（用于验收链路）
  - `minScore`（默认 85）
  - `maxWarnings`（默认 10）
  - `maxDiffs`（默认 10）
- **policy（可选）**：项目策略覆写（用于 forbidden gate 等）

---

## 3. 三种 target.kind 的最小示例

### 3.1 Vue（web-strict）

```json
{
  "id": "case-vue-9277-28654",
  "designRef": { "fileKey": "53hw0wDvgOzH14DXSsnEmE", "nodeId": "9277-28654" },
  "target": { "kind": "vue", "entry": "./src/components/figma-batch/FigmaNode9277x28654/index.vue" },
  "mount": { "mountPage": "./src/pages/figma-preview.vue", "mode": "inject" },
  "audit": { "mode": "web-strict" },
  "limits": { "minScore": 85, "maxWarnings": 10, "maxDiffs": 10 }
}
```

### 3.2 React（web-strict）

```json
{
  "id": "case-react-9277-28654",
  "designRef": { "fileKey": "53hw0wDvgOzH14DXSsnEmE", "nodeId": "9277-28654" },
  "target": { "kind": "react", "entry": "./src/components/figma-batch/FigmaNode9277x28654/index.tsx" },
  "mount": { "mountPage": "./src/pages/figma-preview.tsx", "mode": "inject" },
  "audit": { "mode": "web-strict" },
  "limits": { "minScore": 85, "maxWarnings": 10, "maxDiffs": 10 }
}
```

### 3.3 HTML（html-partial）

```json
{
  "id": "case-html-9277-28654",
  "designRef": { "fileKey": "53hw0wDvgOzH14DXSsnEmE", "nodeId": "9277-28654" },
  "target": { "kind": "html", "entry": "./figma-html/case-html-9277-28654.fragment.html" },
  "mount": { "mountPage": "./public/figma-preview.html", "mode": "inject", "marker": "case-html-9277-28654" },
  "audit": { "mode": "html-partial" },
  "limits": { "minScore": 60, "maxWarnings": 50, "maxDiffs": 50 }
}
```

建议：

- HTML `entry` 建议是“片段文件”，不要包含 `<html>`/`<body>` 外壳。
- 需要页面可见时：配置 `mountMode=auto` + `mountPage`，或由 Agent 在约定预览页手动 import `target.entry`（每个 case 使用独立 `marker` 避免冲突）。

