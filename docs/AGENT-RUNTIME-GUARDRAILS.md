# Agent 运行时门禁（project-setup + hygiene）

> 版本：**4.6.0+** · 解决「忘记 AGENT-SETUP」、「reports/runtime 胶水脚本」与「项目根 staging 残留」三类回归。

## 1. project-setup（机器可读）

| 文件 | 作用 |
|------|------|
| `figma-cache/project-setup.manifest.json` | `pending` → `complete` |

| 命令 | 说明 |
|------|------|
| `figma-cache project-setup init` | `cursor init` 内建；写 `pending` |
| `figma-cache project-setup status` | 检查 adapter/config（未完成可 exit 2） |
| `figma-cache project-setup finish` | 通过检查后写 `complete` |

**完成条件（finish）**

- 无 `.cursor/rules/02-figma-stack-adapter.mdc`
- 至少一个 `.cursor/rules/02-figma-*-adapter.mdc`（非 stack 占位）
- `figma-cache.config.cjs` 或 `.js` 可加载
- ESM 项目（`"type":"module"`）优先 `.cjs` 配置

**硬门禁**

```bash
figma-cache validate --strict-project
FIGMA_CACHE_REQUIRE_PROJECT_SETUP=1 pnpm run fc:mcp:ingest:url -- "https://..."
figma-cache project-setup finish   # 先完成 AGENT-SETUP
```

`cursor init`：若 manifest 已为 `complete`，默认**不再刷新** `AGENT-SETUP-PROMPT.md`（`--overwrite` 强制）。

## 2. agent-runtime-hygiene（禁止胶水）

扫描 `figma-cache/reports/runtime/` 与**项目根** `staging-ingest-*`：

- **blocking**：`reports/runtime` 下任意 `*.cjs` / `*.mjs`
- **blocking**：`reports/runtime/staging-*` 或项目根 `staging-ingest-*` 且无 `.fc-mcp-ingest-staging` 标记

```bash
figma-cache validate --hygiene
pnpm run fc:agent:hygiene
pnpm run fc:doctor -- --strict   # 含 projectSetup + agentHygiene
```

**正确 ingest（Windows）**

```bash
pnpm run fc:mcp:ingest:url -- "https://www.figma.com/design/...?node-id=1-2"
# 或
node node_modules/figma-to-code-pipeline/scripts/workflow/mcp-raw-ingest.cjs --quiet --stdin --url="..."
```

**禁止**：`pnpm run fc:mcp:ingest:quiet -- --url`；禁止在 `reports/runtime` 或项目根写 `ingest-*.cjs` 胶水。

**推荐（4.6+）**：MCP 三段写入 `staging-ingest-<node>/` 后使用 **`--staging-dir`** 或 **`--stdin`** / **`--materialize-staging`**；域清单用 **`fc:mcp:cache:manifest`**；segment 迁移用 **`fc:mcp:resegment`**。

## 3. 批量缓存与域清单（无胶水）

```bash
# 多 URL + MCP payload（Agent 收集后一次落盘）
pnpm run fc:mcp:batch:cache -- --batch-json=payloads.json --skip-existing --require-project-setup
```

`payloads.json` 为数组：`{ "url", "get_design_context", "get_metadata", "get_variable_defs" }`。

仅 `--urls-file` 且无 payload 时不会调 MCP，只用于检查缺失缓存。

```bash
# 域清单缺口检测 / 批量 ingest（任意消费方，不绑定 sip）
pnpm run fc:mcp:cache:manifest -- --manifest=figma-cache/manifests/my-domain/nodes.manifest.json
pnpm run fc:mcp:cache:manifest -- --manifest=payloads.json --ingest --skip-existing

# 已有 mcp-raw 迁 segment（无需重拉 MCP；默认保留源路径）
pnpm run fc:mcp:resegment -- --file-key=... --node-id=3710:5718 --node-segment=sip
# 确认 index 已指向目标 segment 后可删除源目录
pnpm run fc:mcp:resegment -- --file-key=... --node-id=3710:5718 --node-segment=sip --remove-source
```

## 4. 业务仓接入清单

1. `npx figma-cache cursor init`
2. `@AGENT-SETUP-PROMPT.md` → 栈 adapter + `figma-cache.config.cjs`
3. `npx figma-cache project-setup finish`
4. 批量导入前：`figma-cache validate --strict-project --hygiene`
5. 升级本包后：已有 complete manifest 时 `cursor init` 不会覆盖 adapter
