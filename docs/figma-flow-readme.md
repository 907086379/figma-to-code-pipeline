# 设计与流程说明（项目骨架）

> 本文件由 **`figma-cache.config.example.js`**（或你自有的 `figma-cache.config.js`）里 **`postEnsure`** 按环境变量 **`FIGMA_CACHE_FLOW_README`**（默认 **`docs/figma-flow-readme.md`**）创建并**按节点幂等追加**登记节；你可整段改写手填区，但不要删除钩子依赖的 HTML 注释锚点（如 `<!-- figma-cache-flow-readme: registry -->`）。

## 流程总览（手填 / 或粘贴 mermaid）

用自然语言写用户路径，或粘贴：

```bash
npm run fc:flow:mermaid -- --flow=<flowId>
```

的输出：

```mermaid
%% flow mermaid 输出贴此处
```

## 交互与边界（手填）

- 分支条件：
- 异常与空状态：

## 已从 Figma 写入缓存的节点（以下由 postEnsure 增量维护）

<!-- figma-cache-flow-readme: registry -->
<!-- 工具链仓库默认不提交 `figma-cache/files/`；业务项目接入 `fc:ensure` / postEnsure 后在此追加节点节。 -->
<!-- cache-node:abcABCd0123456789vWxyZ#1:2 -->
### `abcABCd0123456789vWxyZ#1:2`

- **Figma**: https://www.figma.com/file/abcABCd0123456789vWxyZ/?node-id=1%3A2
- **syncedAt**: 2026-05-07T03:23:53.335Z
- **source**: figma-mcp
- **completeness**: layout, text, tokens, interactions, states, accessibility
- **spec**: `C:/Users/90708/AppData/Local/Temp/fc-mcp-ingest-UP6RNk/figma-cache/files/abcABCd0123456789vWxyZ/nodes/1-2/spec.md` · **meta**: `C:/Users/90708/AppData/Local/Temp/fc-mcp-ingest-UP6RNk/figma-cache/files/abcABCd0123456789vWxyZ/nodes/1-2/meta.json`
- **提示**: 像素级还原以 `spec.md` / `raw.json` 为准；用户路径请维护 `flows` 后把 `npm run fc:flow:mermaid` 输出贴到下方「流程总览」。
<!-- cache-node:uXebQLeH4VAJbjcPtYelUp#11038:684 -->
### `uXebQLeH4VAJbjcPtYelUp#11038:684`

- **Figma**: https://www.figma.com/file/uXebQLeH4VAJbjcPtYelUp/?node-id=11038%3A684
- **syncedAt**: 2026-05-12T03:31:02.640Z
- **source**: figma-mcp
- **completeness**: layout, text, tokens, interactions, states, accessibility
- **spec**: `figma-cache/files/uXebQLeH4VAJbjcPtYelUp/nodes/11038-684/spec.md` · **meta**: `figma-cache/files/uXebQLeH4VAJbjcPtYelUp/nodes/11038-684/meta.json`
- **提示**: 像素级还原以 `spec.md` / `raw.json` 为准；用户路径请维护 `flows` 后把 `npm run fc:flow:mermaid` 输出贴到下方「流程总览」。
<!-- cache-node:uXebQLeH4VAJbjcPtYelUp#11101:839 -->
### `uXebQLeH4VAJbjcPtYelUp#11101:839`

- **Figma**: https://www.figma.com/file/uXebQLeH4VAJbjcPtYelUp/?node-id=11101%3A839
- **syncedAt**: 2026-05-12T03:33:45.560Z
- **source**: figma-mcp
- **completeness**: layout, text, tokens, interactions, states, accessibility
- **spec**: `figma-cache/files/uXebQLeH4VAJbjcPtYelUp/nodes/11101-839/spec.md` · **meta**: `figma-cache/files/uXebQLeH4VAJbjcPtYelUp/nodes/11101-839/meta.json`
- **提示**: 像素级还原以 `spec.md` / `raw.json` 为准；用户路径请维护 `flows` 后把 `npm run fc:flow:mermaid` 输出贴到下方「流程总览」。
<!-- cache-node:uXebQLeH4VAJbjcPtYelUp#11147:1506 -->
### `uXebQLeH4VAJbjcPtYelUp#11147:1506`

- **Figma**: https://www.figma.com/file/uXebQLeH4VAJbjcPtYelUp/?node-id=11147%3A1506
- **syncedAt**: 2026-05-12T03:34:45.085Z
- **source**: figma-mcp
- **completeness**: layout, text, tokens, interactions, states, accessibility
- **spec**: `figma-cache/files/uXebQLeH4VAJbjcPtYelUp/nodes/11147-1506/spec.md` · **meta**: `figma-cache/files/uXebQLeH4VAJbjcPtYelUp/nodes/11147-1506/meta.json`
- **提示**: 像素级还原以 `spec.md` / `raw.json` 为准；用户路径请维护 `flows` 后把 `npm run fc:flow:mermaid` 输出贴到下方「流程总览」。
<!-- cache-node:reconcileTest01AbCdEfGhIjKlMnOp#9:8 -->
### `reconcileTest01AbCdEfGhIjKlMnOp#9:8`

- **Figma**: https://www.figma.com/file/reconcileTest01AbCdEfGhIjKlMnOp/?node-id=9%3A8
- **syncedAt**: 2026-05-12T07:36:01.908Z
- **source**: figma-mcp
- **completeness**: layout, text, tokens, interactions, states, accessibility
- **spec**: `C:/Users/90708/AppData/Local/Temp/fc-cache-reconcile-HnTjWN/figma-cache/files/reconcileTest01AbCdEfGhIjKlMnOp/nodes/9-8/spec.md` · **meta**: `C:/Users/90708/AppData/Local/Temp/fc-cache-reconcile-HnTjWN/figma-cache/files/reconcileTest01AbCdEfGhIjKlMnOp/nodes/9-8/meta.json`
- **提示**: 像素级还原以 `spec.md` / `raw.json` 为准；用户路径请维护 `flows` 后把 `npm run fc:flow:mermaid` 输出贴到下方「流程总览」。
<!-- cache-node:uXebQLeH4VAJbjcPtYelUp#11038:687 -->
### `uXebQLeH4VAJbjcPtYelUp#11038:687`

- **Figma**: https://www.figma.com/file/uXebQLeH4VAJbjcPtYelUp/?node-id=11038%3A687
- **syncedAt**: 2026-05-12T07:40:10.916Z
- **source**: figma-mcp
- **completeness**: layout, text, tokens, interactions, states, accessibility
- **spec**: `figma-cache/files/uXebQLeH4VAJbjcPtYelUp/nodes/11038-687/spec.md` · **meta**: `figma-cache/files/uXebQLeH4VAJbjcPtYelUp/nodes/11038-687/meta.json`
- **提示**: 像素级还原以 `spec.md` / `raw.json` 为准；用户路径请维护 `flows` 后把 `npm run fc:flow:mermaid` 输出贴到下方「流程总览」。

