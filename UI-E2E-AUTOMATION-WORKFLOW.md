# UI E2E 自动化流程说明（toolchain -> 目标项目）

这份文档用于快速落地 **`figma-to-code-pipeline` 到目标项目**（如与 toolchain 仓库并列的 `vue-demo`；下文命令里用 **`../vue-demo`** 表示从本仓库根目录进入该目录）的联调验收流程。  
目标：尽量自动化，失败时自动产出 Agent 接力任务，形成稳定闭环。

若业务仓不在上一级、或目录名不是 `vue-demo`，请把命令里的 `../vue-demo` 换成你的实际相对路径（或绝对路径）。

---

## 我的常用命令（速用）

> 适用于你当前“每轮必须从空文件重生成，再验收”的工作流。

### 推荐：一条命令挂起等待（删 -> 缺文件失败 -> 等文件出现 -> 自动验收 + build）

在目标项目执行（默认最多等 30 分钟；超时退出码 2）：

```bash
npm run fc:workflow:fresh:one-shot
```

然后你只需要做一件事：**新开 Agent 会话重生成组件**（脚本会自动轮询 `figma-e2e-batch.json` 里的 `target` 文件是否出现）。

说明：`one-shot` 默认会在验收通过后执行 `vite build`（见目标项目 `package.json` 脚本），用于尽早捕获 SFC 语法类问题。

### 备选：拆成两步（你更喜欢手动控制时）

1) 删并确认失败：

```bash
npm run fc:workflow:fresh:start
```

2) Agent 重生成后，只跑验收：

```bash
npm run fc:workflow:fresh:verify
```

或只“等待文件出现后自动验收”（**不先删**；适合你已经手动删过文件、或只想等 Agent 写完再验）：

```bash
npm run fc:workflow:fresh:wait-verify
```

---

## 1. 适用场景

- 你已经在 toolchain 仓库（本仓库）开发并发布了新版本 npm 包
- 你希望在目标业务项目自动联调，而不是手工逐步执行
- 你接受“自动编排 + Agent 接力修复”的半自动闭环（推荐）

---

## 2. 核心能力一览

- `fc:ui:e2e:cross`：跨项目联调总控（本仓库执行）
  - 自动 `npm pack` 当前包并安装到目标项目
  - 自动执行目标项目验收链路
  - 支持 cache miss 自动补齐
  - 支持失败自动重试
  - 支持失败自动产出 `agent-task.md`

- `fc:ui:accept`：效果导向自动验收（目标项目执行）
  - 自动跑 preflight -> audit -> aggregate
  - 以退出码判定 pass/fail
  - 运行报告输出到 `figma-cache/reports/runtime/*.json`

---

## 3. 一次性准备

### 3.1 目标项目准备（在 `vue-demo` 根目录执行；与 toolchain 并列时先 `cd ../vue-demo`）

```bash
cd ../vue-demo
npm i -D figma-to-code-pipeline@latest
npx figma-cache cursor init
```

补充（多根工作区本地联调推荐）：

- 若你的 `vue-demo/package.json` 已配置 `figma-to-code-pipeline` 为本地源码依赖（推荐 `file:../figma-to-code-pipeline`，与父工作区目录名一致），则不需要安装 `@latest`。
- 本地源码联调时建议用 `npm install` 刷新依赖即可；仅在需要“验证发布包”时再用 `npm pack`/tgz 或 `@latest`。

### 3.2 准备批量文件（推荐）

目标项目根目录创建：`figma-e2e-batch.json`

```json
[
  {
    "fileKey": "53hw0wDvgOzH14DXSsnEmE",
    "nodeId": "9277-28772",
    "target": "./src/pages/main/components/AudioSettingsPanel/index.vue",
    "minScore": 85,
    "maxWarnings": 10,
    "maxDiffs": 10
  }
]
```

`target` 为**相对于目标项目根目录**的路径（与 `figma-e2e-batch.json` 所在目录一致），便于克隆到任意盘符。

---

## 4. 推荐主流程（自动编排）

在 **toolchain 仓库** 执行：

```bash
npm run fc:ui:e2e:cross -- --target-project=../vue-demo --batch-file=../vue-demo/figma-e2e-batch.json --auto-ensure-on-miss --fix-loop=2 --emit-agent-task-on-fail
```

### 参数说明

- `--auto-ensure-on-miss`：cacheKey 不存在时自动尝试 `figma-mcp ensure`
- `--fix-loop=2`：失败后自动重试 2 轮（补 contract/刷新缓存后复跑）
- `--emit-agent-task-on-fail`：失败时在目标项目根生成 `agent-task.md`（上例即 `../vue-demo/agent-task.md`）
- `--batch-file=...`：批量节点执行

---

## 5. 结果判定

看命令输出中的这两个字段：

- `ok: true`
- `summaryStatus: healthy`

并以退出码为准：

- `0` = 通过
- `2` = 失败（需处理）

补充：`fc:ui:e2e:cross` 已启用真实组件链路保护：

- `target` 文件不存在会直接失败
- 若验收出现 `code-level comparison skipped` 会直接失败（除非显式传 `--allow-skipped-code-level-comparison`）

---

## 6. 失败后的接力流程（Agent 模式）

若失败且已启用 `--emit-agent-task-on-fail`，会自动在目标项目根生成 **`agent-task.md`**。

你只需要在目标项目新开 Agent 并发送：

```text
请按目标项目根目录下的 agent-task.md 执行，修复后必须跑验收，直到通过再停止。
```

修完后回到 toolchain 仓库重新执行第 4 节命令，完成闭环。

---

## 7. Fresh 重生成工作流（推荐真实回归）

适用于“每轮必须从空文件开始，禁止沿用旧组件”的场景。

在目标项目执行：

```bash
npm run fc:workflow:fresh:start
```

该命令会：

- 删除 `figma-e2e-batch.json` 中全部 `target` 组件文件
- 立刻跑一次验收，并要求“因 target 缺失而失败”
- 输出下一步提示：开新 Agent 会话重新生成组件

Agent 重生成完成后，在目标项目执行：

```bash
npm run fc:workflow:fresh:verify
```

如果你已经手动删除了 `target` 文件（例如 `AudioSettingsPanel/index.vue`），可以直接从等待/验收开始：

```bash
npm run fc:workflow:fresh:wait-verify
```

或在你确认组件已生成后直接跑：

```bash
npm run fc:workflow:fresh:verify
```

该命令会：

- 若组件仍缺失，直接失败并列出缺失文件
- 若组件已生成，执行批量验收并要求通过

---

## 8. 常见使用模式

### 模式 A：单节点快速验证

```bash
npm run fc:ui:e2e:cross -- --target-project=../vue-demo --fileKey=53hw0wDvgOzH14DXSsnEmE --nodeId=9277-28772 --target=./src/pages/main/components/AudioSettingsPanel/index.vue --auto-ensure-on-miss --fix-loop=2 --emit-agent-task-on-fail
```

### 模式 B：批量回归（推荐日常）

```bash
npm run fc:ui:e2e:cross -- --target-project=../vue-demo --batch-file=../vue-demo/figma-e2e-batch.json --auto-ensure-on-miss --fix-loop=2 --emit-agent-task-on-fail
```

### 模式 C：严格抽检（发布前）

```bash
npm run fc:ui:e2e:cross -- --target-project=../vue-demo --batch-file=../vue-demo/figma-e2e-batch.json --profile=strict --auto-ensure-on-miss --fix-loop=2 --emit-agent-task-on-fail
```

---

## 9. 建议节奏（避免混乱）

- 日常开发：模式 B（batch）
- 发布前：模式 C（strict）
- 真实性回归：先跑 `fc:workflow:fresh:start`，再新会话重生成，再跑 `fc:workflow:fresh:verify`
- 失败：让 Agent 接手 `agent-task.md`，不要手工盲改
- 稳定后再收紧阈值（`minScore`、`maxWarnings`、`maxDiffs`）

---

## 10. 排障提示

- `cacheKey miss`：加 `--auto-ensure-on-miss`
- `contract missing`：先跑 `cursor init`，或让跨项目命令自动 bootstrap
- 分数低但页面看起来还行：先放宽阈值，再逐步收紧
- 输出 `acceptance: null`：这不影响总判定，仍以退出码与 summary 为准
- Vite 报 `[plugin:vite:vue] Single file component can contain only one <template> element`：说明生成文件出现重复 SFC 块，需先修复语法再验收

---

## 11. 你真正需要记住的一条命令

```bash
npm run fc:ui:e2e:cross -- --target-project=../vue-demo --batch-file=../vue-demo/figma-e2e-batch.json --auto-ensure-on-miss --fix-loop=2 --emit-agent-task-on-fail
```

这条命令就是默认主入口。

