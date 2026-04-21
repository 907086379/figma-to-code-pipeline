---
name: figma-ui-dual-mode-execution
description: 仅用 nodeId（如 9277-28772）或 Figma 链接触发 UI 实现，自动在短流程与严格流程间切换。
---

# Figma UI Dual Mode Execution

本 Skill 用于：用户仅提供节点线索（节点目录名、nodeId、或带 node-id 的 Figma 链接）时，自动完成“定位缓存 -> 判定模式 -> 实现与验证”。

## 支持输入

- 节点目录名：如 `9277-28772`
- nodeId：如 `9277:28772`
- Figma 链接：`...node-id=9277-28772`（需转换为 `9277:28772`）

## 执行步骤（强制）

1. 规范化节点标识：
   - `9277-28772` -> `9277:28772`
2. 在 `figma-cache/index.json` 查命中并定位节点目录。
3. 读取四份必读文件：
   - `spec.md`
   - `raw.json`
   - `state-map.md`
   - `mcp-raw-get-design-context.txt`
4. 读取全局 adapter contract（新增强制项）：
   - 默认路径：`figma-cache/adapters/ui-adapter.contract.json`
   - 目标：把 token/state 从设计事实映射到项目实现（变量/class/主题 token）
5. 模式选择：
   - 默认短流程；
   - 命中任一升级条件（老项目/全局样式改动/复杂状态/历史漂移问题/信息冲突）-> 切严格流程。
6. 预检文档策略（降噪）：
   - 默认短流程：可跳过完整预检文档，仅输出精简事实清单。
   - 严格流程：必须基于 `cursor-bootstrap/examples/ui-1to1-preflight.template.md` 生成并填写“预检文档”（可落到项目 `figma-cache/docs/` 或节点目录旁），至少完成：设计值快照、状态对照表、1:1 预检清单。
7. 先输出“事实对齐清单”，再实现组件与挂载。
8. 改动后执行 lint，并输出映射与验证结论。

## 关键硬约束

- **样式**：优先 **Tailwind**（或栈上等价的 Tailwind 兼容原子类，如 UnoCSS Tailwind 预设）；**HTML/片段** 可通过 CDN 或项目构建引入 Tailwind 后用 `class` 还原。**行内 `style`** 仅用于少数可解释场景（封装复用、Tailwind 无法实现、库强制），并在输出中说明原因。
- 冲突裁决顺序：`mcp-raw-get-design-context.txt` 优先。
- 禁止猜测设计值；无法裁决必须先提问。
- 对 token/state 未命中 adapter contract 的项，必须先补 mapping 或向用户确认，禁止凭经验填色。
- 禁止使用 Figma 临时远程资产 URL 作为运行时图标。
- **「图标」≠「所有 `<img>`」**：上一条仅约束 **图标/glyph**（含 MCP 导出的矢量切片当图标用时）。`mcp-raw-get-design-context.txt` 里对 **Frame/照片/装饰位图** 等已写明的 `<img>` 与 URL 常量，属于**设计事实**；若目标项目另有「禁止一切远程 `img`」的全局策略，必须**在交付说明中显式写出依据与降级方案**（例如落盘为本地静态资源），**禁止**在无依据的情况下用渐变、自造色、臆造形状顶替稿中结构与资源引用。
- 图标优先项目图标系统；无则 `inline svg`。
- 默认按 `border-box` 思维实现；弹层必须锚定触发器。

## 固定输出

1. 缓存定位结果（命中节点目录）
2. 事实对齐清单（结构/文案/token/状态/交互）
3. adapter contract 命中结果（命中项 / 缺失项）
4. 变更文件列表
5. 关键设计值 -> 代码映射
6. lint/验证结果
7. 未决问题（如有）
