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
<!-- cache-node:abcABCd0123456789vWxyZ#1:2 -->
### `abcABCd0123456789vWxyZ#1:2`

- **Figma**: https://www.figma.com/file/abcABCd0123456789vWxyZ/?node-id=1%3A2
- **syncedAt**: 2026-04-20T05:50:52.169Z
- **source**: figma-mcp
- **completeness**: layout, text, tokens
- **spec**: `C:/Users/90708/AppData/Local/Temp/figma-cache-smoke-upsert-ok-NXLPh7/figma-cache/files/abcABCd0123456789vWxyZ/nodes/1-2/spec.md` · **meta**: `C:/Users/90708/AppData/Local/Temp/figma-cache-smoke-upsert-ok-NXLPh7/figma-cache/files/abcABCd0123456789vWxyZ/nodes/1-2/meta.json`
- **提示**: 像素级还原以 `spec.md` / `raw.json` 为准；用户路径请维护 `flows` 后把 `npm run fc:flow:mermaid` 输出贴到下方「流程总览」。

