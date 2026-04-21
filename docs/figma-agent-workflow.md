# Figma Agent Workflow（Canonical）

> 本文档是 Agent 执行流程的工具链权威版本。  
> 执行以命令入口为准，文档仅用于解释。

## 目标

- 让 Agent 从“节点导入”到“工程化建议应用”尽量自动完成。
- 人只做监督与必要决策，不参与重复操作。

## 执行原则

- **先导入节点，再做组件**：支持批量导入多节点，不要求一次性完成组件实现。
- **命令是唯一执行入口**：优先使用 npm 脚本，不依赖对话记忆。
- **默认自动化**：优先 `auto`；需要保守审计时切 `strict`。

## 标准命令入口

### 单节点/多节点导入

```bash
npm run fc:batch:add -- "<figma-url|cacheKey|node-id>" --fileKey=<fileKey> --kind=vue
```

执行后会更新：

- `figma-e2e-batch.json`（含 `naming` / `signals`）
- `component-relations.json`
- `component-engineering-suggestions.json`

### 建议计划与应用

- `auto`（默认，允许自动创建缺失 icon 映射）  
  - `npm run fc:ui:suggestions:plan`
  - `npm run fc:ui:suggestions:apply`

- `strict`（不自动创建，只用已有映射）  
  - `npm run fc:ui:suggestions:plan:strict`
  - `npm run fc:ui:suggestions:apply:strict`

### 一键入口（推荐 Agent 使用）

- `npm run fc:agent:auto`
- `npm run fc:agent:strict`

以上入口会自动串联 `plan -> apply -> verify`。

## 人工监督最小动作

只看三件事：

1. 节点到组件命名映射是否符合预期。
2. 建议计划里是否存在必须人工确认的极少数项（理想为 0）。
3. `npm run fc:workflow:fresh:verify` 是否通过。
