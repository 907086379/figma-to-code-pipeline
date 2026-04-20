# Figma 缓存一页式速查（团队版）

## 1) 日常只做这三步

1. 把 Figma 链接和目标发给 Agent（是否强制刷新请写清楚）。
2. 有流程关系时写明前后页/分支/跳转。
3. 看回报是否包含：缓存状态、来源、MCP 调用次数、输出文件。

## 2) 默认执行链（统一口径）

`先查本地缓存 -> 按需 MCP -> mcp-raw/ 落盘 -> upsert/ensure -> validate`

## 3) 三条红线

- `ensure` 不是 MCP 拉取器。
- `source=figma-mcp` 但没有 `mcp-raw/` 证据，不算完成。
- `upsert/ensure` 后 `validate` 未通过，不算完成。

## 4) completeness 记忆法

- 默认：`layout,text,tokens,interactions,states,accessibility`
- `flow` 仅在关系关键词或多链接串联意图时自动追加
- 仅视觉微调/单链接无关系/仅资产导出：通常不自动补 `flow`

## 5) 主提示词（建议直接复制）

```text
请按项目 figma 缓存规则处理下面链接：先查本地缓存，未命中或字段不足再按需调用 figma-mcp；原始回包写入 mcp-raw/ 后执行 upsert/ensure；最后执行 fc:validate。请回报缓存状态、来源、MCP 调用次数、输出文件清单；若自动补 flow，请说明触发原因。

[Figma 链接]
```

## 6) 排障常用命令

```bash
npm run fc:config
npm run fc:get -- "<figma-url>"
npm run fc:validate
npm run fc:budget
```

更多细节：`figma-cache/docs/colleague-guide-zh.md`