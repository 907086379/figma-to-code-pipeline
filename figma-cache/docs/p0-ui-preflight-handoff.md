# P0 执行交接文档：UI Preflight 门禁落地

> 目标：先落地 **P0**，让 UI 生成前有机器门禁，减少“生成后返工”。
> 
> 本文档给下一个 Agent 直接执行，按顺序完成即可。

---

## 1. 背景与目标

当前项目已有：

- `figma-cache validate`：索引/证据完整性门禁
- `fc:contract:check`：token/state 映射门禁
- `fc:ui:gate`：聚合门禁（当前无 preflight）

缺口：

- 缺少“面向 UI 任务”的结构化 preflight 产物与阻断策略。
- 当前 gate 偏通用校验，无法直观看到“为何当前 cacheKey 不适合开工写组件”。

P0 目标：

1. 新增 `fc:ui:preflight` 命令（脚本 `scripts/ui/ui-preflight.js`）。
2. 生成结构化报告（默认输出到 `figma-cache/reports/ui-preflight-report.json`）。
3. 存在阻断项时返回非零退出码（建议 `2`）。
4. 将 preflight 接到 `fc:ui:gate` 前置步骤。
5. 增加 smoke 覆盖与文档说明。

---

## 2. 设计约束（必须遵守）

- 不修改 Core 语义边界：`figma-cache/figma-cache.js` 继续保持“缓存/索引/校验入口”。
- P0 先做“门禁与可观测性”，不做 1:1 评分器（那是 P1）。
- 新脚本必须支持 PowerShell 与 CI（Linux）执行。
- 输出报告必须机器可读 JSON，便于后续接 CI 与二次分析。
- 默认尽量零配置可跑；参数可选。

---

## 3. 需要改动的文件（最小集）

### 3.1 新增

- `scripts/ui/ui-preflight.js`

### 3.2 修改

- `package.json`
  - 新增 script：`fc:ui:preflight`
  - 调整 script：`fc:ui:gate` 前置执行 preflight
- `tests/smoke.js`
  - 增加 preflight 正向/负向用例
- `README.md`
  - 增加 preflight 与 gate 新流程
- `figma-cache/docs/README.md`
  - 增加 preflight 命令、参数、报告字段

> 若有必要，可补一个文档：`figma-cache/docs/ui-preflight-spec.md`（可选）

---

## 4. `scripts/ui/ui-preflight.js` 规格（执行标准）

## 4.1 CLI 参数

建议支持：

- `--cacheKey=<fileKey#nodeId>`（可选；不传则扫描全部 items）
- `--contract=<path>`（可选；默认 `figma-cache/adapters/ui-adapter.contract.json`）
- `--report=<path>`（可选；默认 `figma-cache/reports/ui-preflight-report.json`）
- `--allow-warn`（可选；仅对 warning 放行，blocking 仍失败）

## 4.2 输入源

- 读取 `FIGMA_CACHE_DIR/index.json`
- 读取 contract JSON
- 对每个命中 item 读取：
  - `paths.meta`
  - `paths.spec`
  - `paths.stateMap`
  - `paths.raw`
  - 若 source=figma-mcp，则读取 `mcp-raw/mcp-raw-manifest.json`

## 4.3 报告结构（建议）

```json
{
  "ok": false,
  "generatedAt": "ISO",
  "summary": {
    "checkedItems": 1,
    "blockingCount": 2,
    "warningCount": 1
  },
  "items": [
    {
      "cacheKey": "xxx#yyy",
      "source": "manual|figma-mcp",
      "blocking": ["..."],
      "warnings": ["..."],
      "checks": {
        "cacheItemExists": true,
        "entryFilesExist": true,
        "coverageEvidenceReady": false,
        "contractExists": true,
        "tokenMappingReady": true,
        "stateMappingReady": false,
        "mcpRawReady": true
      }
    }
  ]
}
```

## 4.4 阻断规则（P0）

任一命中即 blocking：

- 指定 cacheKey 不存在
- item 缺失关键文件路径或文件不存在
- `raw.coverageSummary.evidence` 缺失/维度为空（按 item.completeness）
- contract 文件不存在或 JSON 非法
- `tokenMappings` 或 `stateMappings` 为空
- source=figma-mcp 时缺失 mcp-raw manifest（或 files 映射缺失）

warning（不阻断，可积累）：

- spec/state-map 中仍存在 TODO 占位
- contract 存在但 mapping 命中率低（可输出统计）

## 4.5 退出码

- `0`: 无 blocking
- `2`: 存在 blocking 或参数错误

---

## 5. gate 接入策略

调整 `package.json`：

- 新增：
  - `"fc:ui:preflight": "node scripts/ui/ui-preflight.js"`
- 调整：
  - `"fc:ui:gate": "npm run fc:ui:preflight && npm run fc:validate && npm run verify:cursor && npm test"`

> 说明：P0 不强制在 gate 中跑 `fc:contract:check`，避免对旧项目立即破坏性升级。可在 P0.5 再接入。

---

## 6. 测试用例（必须）

在 `tests/smoke.js` 至少补以下：

1. **negative**：指定不存在 cacheKey，preflight 返回 `status=2`
2. **negative**：构造 raw evidence 缺失，preflight 返回 `status=2`
3. **positive**：构造最小完整 item + contract，preflight 返回 0，且报告 `ok=true`
4. **assert 报告文件存在**：默认 report 路径成功写出

---

## 7. 验收命令（交付前必须全部通过）

按顺序执行：

1. `npm run verify:cursor:sync`
2. `npm run verify:cursor`
3. `npm test`
4. `npm run fc:ui:preflight`（至少跑一次）
5. `npm run fc:ui:gate`

---

## 8. 风险与注意事项

- `package.json` 当前格式被 PowerShell 写成“宽缩进 + 转义字符形式”，属于可接受状态；若后续要美化，单独做格式提交，不要混在 P0 逻辑提交里。
- `figma-cache/files/*` 可能有历史样例数据，不要把“样例缺陷”误当脚本 bug。
- 在 Windows PowerShell 5.1 中链式命令不要用 `&&`；优先 `;`。

---

## 9. 建议提交信息（给下一个 Agent）

```text
feat(gate): 新增 figma ui preflight 结构化门禁并接入 fc:ui:gate

- 新增 scripts/ui/ui-preflight.js，输出 ui-preflight-report.json 并对阻断项返回 exit code 2。
- 在 package.json 增加 fc:ui:preflight，且将 fc:ui:gate 前置 preflight 执行。
- 扩展 smoke 覆盖 preflight 的正负场景与报告落盘断言。
- 同步 README 与 figma-cache/docs/README.md，补充 preflight 使用说明与报告字段。
```

---

## 11. 全量优化路线图（P1/P2/P3）

- 总体路线图文档：`figma-cache/docs/ui-1to1-optimization-roadmap.md`
- 建议：先完成本文件 P0，再按路线图推进 P1 -> P2 -> P3。

---
## 10. 当前上下文状态（切换 Agent 前说明）

- 最新提交：`8f27b82`
- 当前工作区：干净
- 本文档已落地，下一位 Agent 直接按本文执行 P0 即可
