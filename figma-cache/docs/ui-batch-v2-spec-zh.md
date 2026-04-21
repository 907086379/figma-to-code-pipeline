# UI 批量接口基线（v2）：DesignRef / TargetSpec / MountSpec / AuditSpec

本文件定义 **`figma-e2e-batch.json` v2** 的**唯一权威接口**，用于把“Figma 设计节点”以批量方式落地到不同目标（Vue / React / HTML）并完成挂载与审计。

重要说明：

- **破坏性更新**：本 v2 与旧格式不兼容；工具链脚本只支持 v2。
- **批量文件名固定**：仍使用 `figma-e2e-batch.json`。
- **目标**：同一套 batch 同时支持多框架 target + 多种 mount + 审计模式差异化。

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
  "entry": "./src/pages/main/components/FigmaNode9277x28654/index.vue",
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

### 1.3 MountSpec（挂载策略）

描述“如何把 TargetSpec.entry 挂载/注入到页面上，便于运行时验证”。

```json
{
  "mountPage": "./src/pages/main/index.vue",
  "mode": "inject",
  "marker": "case-0"
}
```

- **mountPage**：挂载页面路径（相对项目根目录）。
  - 支持：`.vue` / `.tsx` / `.jsx` / `.html`
- **mode（可选）**：
  - `inject`（默认）：工具链自动注入（Vue/React/HTML 均可）
  - `iframe`：预留（目前不实现，后续可用于隔离渲染环境）
  - `manual`：预留（用于显式声明“不自动改文件”）
- **marker（可选）**：用于 HTML 注入或多 case 区分挂载位。
  - 默认：`case-<index>`（例如 `case-0`）

HTML 注入约定：

- 优先定位容器：`<div data-figma-mount="<marker>"></div>`
- 若不存在，会在 `<body>` 末尾自动创建该容器（幂等）。
- 注入内容来自 `target.entry` 文件的文本内容。
- 重复执行必须 **替换** 同一 marker 的内容，而不是追加（幂等）。

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
      "target": { "kind": "vue", "entry": "./src/pages/main/components/FigmaNode9277x28654/index.vue" },
      "mount": { "mountPage": "./src/pages/main/index.vue", "mode": "inject" },
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
  "target": { "kind": "vue", "entry": "./src/pages/main/components/FigmaNode9277x28654/index.vue" },
  "mount": { "mountPage": "./src/pages/main/index.vue", "mode": "inject" },
  "audit": { "mode": "web-strict" },
  "limits": { "minScore": 85, "maxWarnings": 10, "maxDiffs": 10 }
}
```

### 3.2 React（web-strict）

```json
{
  "id": "case-react-9277-28654",
  "designRef": { "fileKey": "53hw0wDvgOzH14DXSsnEmE", "nodeId": "9277-28654" },
  "target": { "kind": "react", "entry": "./src/pages/main/components/FigmaNode9277x28654/index.tsx" },
  "mount": { "mountPage": "./src/pages/main/App.tsx", "mode": "inject" },
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
- `mount.mountPage` 用一个固定的预览页即可；`ui-mount-batch --all` 会为每个 case 保证独立 marker 幂等挂载。

