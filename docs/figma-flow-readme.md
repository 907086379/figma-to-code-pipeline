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
