# iOS / Android 适配模板（基于 figma-cache）

本模板用于把 `figma-cache` 的通用缓存，转成 iOS 与 Android 可直接讨论和拆解的“实现输入”。

## 目标

- 复用已缓存的 Figma 节点数据，避免重复 MCP 拉取。
- 将 `layout / text / tokens / interactions / states / accessibility` 六个维度，整理为移动端可执行项。
- 先输出“统一移动端规格 JSON”，再由各端（SwiftUI / Compose）各自映射到代码。

## 建议目录（业务项目）

```
figma-cache/
  index.json
  files/
mobile-adapter/
  field-mapping.template.json
  ios/
  android/
```

## 快速开始

1. 先确保目标节点已进入本地缓存（`figma:cache:get` / `figma:cache:upsert`）。
2. 运行：

```bash
npm run figma:cache:mobile:spec -- --url "<figma-url>" --platform all
```

3. 产物默认写入：`figma-cache/mobile-specs/<cacheKey>/mobile-spec.json`

## 参数说明

- `--url`：必填，必须与 `index.json` 中记录的 `item.url` 一致。
- `--platform`：`ios` / `android` / `all`（默认 `all`）。
- `--out-dir`：可选，输出目录，默认 `figma-cache/mobile-specs`。

## 输出内容说明

`mobile-spec.json` 包含：

- `source`：节点来源、同步时间、完整度、缺失维度。
- `normalized`：从 `spec.md` 与 `raw.json` 汇总的六大维度文本。
- `platforms.ios` / `platforms.android`：按平台给出的实现关注点与风险提示。
- `todoWarnings`：自动识别 TODO/待补充字段，提醒不可直接当成 1:1 还原完成。

## 推荐落地方式

- iOS：把 `tokens` 映射到 Design Token（Color/Font/Spacing），UI 用 SwiftUI 组件库承接。
- Android：把 `tokens` 映射到 Compose Theme（colorScheme/typography/spacing）或 XML 资源。
- 交互与状态：优先落在“状态机/Reducer”层，不把状态散落在视图代码里。
- 无障碍：把 `accessibility` 变成验收清单（VoiceOver/TalkBack、焦点顺序、语义标签）。

## 边界说明

- 本模板不直接生成 Swift/Kotlin UI 代码；它负责“统一规格整理”。
- 若 `coverageSummary.missing` 包含 `interactions/states/accessibility/flow/assets`，应按受限还原处理。

## 当前决策记录（2026-04-15）

- 当前阶段先聚焦 Web 方案落地与验证。
- iOS/Android 深化（如直接代码生成、平台专属模板扩展）暂缓。
- 待 Web 方案稳定后，再评估并推进原生侧进一步自动化。