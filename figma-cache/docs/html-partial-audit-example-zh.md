# HTML 最小可行审计（html-partial）示例

本示例演示 `audit.mode = "html-partial"` 的行为：

- **只对照**：Text（文案）与 Tokens（颜色 hex）是否出现在目标 HTML 文本中
- **明确跳过**：layout / states / interactions / accessibility，并在报告里标注 `skippedDimensions`
- **不因跳过默认失败**：是否失败由 `limits.minScore` 与实际 text/token 命中决定

---

## 1) 示例 case（figma-e2e-batch.json v2）

```json
{
  "id": "case-html-9277-28654",
  "designRef": { "fileKey": "53hw0wDvgOzH14DXSsnEmE", "nodeId": "9277-28654" },
  "target": { "kind": "html", "entry": "./figma-html/case-html-9277-28654.fragment.html" },
  "mount": { "mountPage": "./figma-preview.html", "mode": "inject", "marker": "case-html-9277-28654" },
  "audit": { "mode": "html-partial" },
  "limits": { "minScore": 80, "maxWarnings": 50, "maxDiffs": 50 }
}
```

---

## 2) 目标 HTML（片段）示例

目标文件 `target.entry` 内容应包含缓存里的关键文案与颜色 hex（示例）：

- 文案：`解除静音`、`打开键盘`、`停止录音`、`恢复通话`、`音频设置`、`结束通话`
- Token hex：`#FD5353`、`#FFFFFF`、`#4D5261`、`#707584`、`#FBFBFC`、`#383C48`

**工具链样式约定（与 `03-figma-ui-implementation-hard-constraints` 一致）**：HTML 片段仍应 **优先 Tailwind**（在 `figma-preview.html` 或片段所在入口引入 Tailwind CDN / 项目既有样式），用 `class` 组织布局与色值；**避免**用大面积行内 `style` 代替可类化规则；仅在封装复用、Tailwind 无法实现等少数场景使用 `style=` 并注明原因。

---

## 3) 报告输出示例（节选）

以下是一次通过的 `ui-1to1-report.json`（节选）：

```json
{
  "ok": true,
  "summary": {
    "auditMode": "html-partial",
    "score": { "total": 100, "text": 100, "token": 100 },
    "skippedDimensions": ["layout", "states", "interactions", "accessibility"]
  },
  "options": {
    "cacheKey": "53hw0wDvgOzH14DXSsnEmE#9277:28654",
    "targetPath": "./figma-html/case-html-9277-28654.fragment.html",
    "mode": "html-partial"
  }
}
```

