/**
 * 项目级 Figma 缓存扩展（示例模板，**不绑定任何 UI 框架**）。
 *
 * 安装本 npm 包并执行 `npx figma-cache cursor init` 后，项目根会出现 **AGENT-SETUP-PROMPT.md**：
 * 请用 Cursor Agent **按该文件全文**执行，以自动生成 `figma-cache.config.js`、栈专属 Adapter、并删除占位规则等（尽量少手动步骤）。
 *
 * 若你已有 `figma-cache.config.js`，可由 Agent 合并而非覆盖。
 *
 * 加载顺序见 `figma-cache/figma-cache.js`：FIGMA_CACHE_PROJECT_CONFIG -> figma-cache.config.js -> .figmacacherc.js
 */

const fs = require("fs");
const path = require("path");

/**
 * Adapter 提示文档基础名：
 * - node 模式时用于节点目录文件名
 * - cache-root 模式时用于 figma-cache 根目录文件名
 */
const ADAPTER_DOC_BASENAME =
  process.env.FIGMA_CACHE_ADAPTER_DOC || "figma-cache-adapter-hint.md";

/**
 * Adapter 提示写入模式：
 * - cache-root（默认）：仅在 figma-cache 目录维护单文件，避免每节点重复
 * - node：按节点目录写入提示
 * - off：关闭提示文件写入
 */
const ADAPTER_DOC_MODE = normalizeAdapterDocMode(
  process.env.FIGMA_CACHE_ADAPTER_DOC_MODE || "cache-root"
);

/**
 * cache-root 模式下的提示文档路径（相对项目根）
 */
const ADAPTER_DOC_CACHE_REL =
  process.env.FIGMA_CACHE_ADAPTER_DOC_CACHE ||
  `figma-cache/docs/${ADAPTER_DOC_BASENAME}`;

/**
 * 提示文档写入策略：
 * - if-missing（默认）：仅目标不存在时写入
 * - always：每次 ensure 都覆盖更新
 */
const ADAPTER_DOC_WRITE_POLICY =
  process.env.FIGMA_CACHE_ADAPTER_DOC_WRITE_POLICY || "if-missing";

/**
 * 全局 UI adapter contract 目标路径（相对项目根）。
 * 该 contract 作为「设计 token/state -> 项目实现」的单一真源。
 */
const ADAPTER_CONTRACT_REL =
  process.env.FIGMA_CACHE_ADAPTER_CONTRACT ||
  "figma-cache/adapters/ui-adapter.contract.json";

/**
 * contract 模板来源（相对项目根，通常来自 cursor-bootstrap）。
 */
const ADAPTER_CONTRACT_TEMPLATE_REL =
  process.env.FIGMA_CACHE_ADAPTER_CONTRACT_TEMPLATE ||
  "cursor-bootstrap/examples/ui-adapter.contract.template.json";

/**
 * 人类可读的「流程 / 需求总览」骨架路径（相对项目根）。仅本示例写入；可在业务项目中改路径或删除相关逻辑。
 * @type {string}
 */
const FLOW_README_REL =
  process.env.FIGMA_CACHE_FLOW_README || "docs/figma-flow-readme.md";

const FLOW_README_REGISTRY_BEGIN = "<!-- figma-cache-flow-readme: registry -->";

/**
 * @param {string} raw
 * @returns {"cache-root" | "node" | "off"}
 */
function normalizeAdapterDocMode(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (value === "node" || value === "node-each") {
    return "node";
  }
  if (value === "off" || value === "none" || value === "disable") {
    return "off";
  }
  return "cache-root";
}

/**
 * @returns {boolean}
 */
function shouldOverwriteAdapterDoc() {
  return String(ADAPTER_DOC_WRITE_POLICY || "")
    .trim()
    .toLowerCase() === "always";
}

/**
 * @param {string} absPath
 * @param {string} content
 * @returns {boolean}
 */
function writeTextByPolicy(absPath, content) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  if (!shouldOverwriteAdapterDoc() && fs.existsSync(absPath)) {
    return false;
  }
  fs.writeFileSync(absPath, content, "utf8");
  return true;
}

/**
 * @param {object} ctx
 * @returns {string}
 */
function buildCacheRootHint(ctx) {
  return `# Figma 缓存 -> UI 实现（目录级提示）

本文件由示例 \`postEnsure\` 生成，默认放在 **figma-cache 目录级**，用于避免“每个节点重复生成同一提示”。

- **默认来源优先级**：先用 \`raw.json\` / \`spec.md\` / \`meta.json\` / \`state-map.md\`，仅在缺口或冲突时再读 \`mcp-raw/*\`
- **证据约束**：同一设计事实只保留一个主证据来源，避免重复引用
- **命中检查**：先查本地缓存命中与字段覆盖，再决定是否需要 MCP 补齐
- **全局映射契约**：先读取 \`${ADAPTER_CONTRACT_REL}\`，将 token/state 映射到项目实现；未映射项禁止猜测

可选模式（环境变量）：
- \`FIGMA_CACHE_ADAPTER_DOC_MODE=cache-root\`（默认）
- \`FIGMA_CACHE_ADAPTER_DOC_MODE=node\`（按节点写入）
- \`FIGMA_CACHE_ADAPTER_DOC_MODE=off\`（关闭）

最近触发：\`${ctx.cacheKey}\`（\`${ctx.syncedAt || ""}\`）
`;
}

/**
 * @param {object} ctx
 * @returns {string}
 */
function buildNodeHint(ctx) {
  const nodeLabel = ctx.nodeId == null ? "" : String(ctx.nodeId);
  return `# Figma 缓存 -> UI 实现（节点提示）

本文件由示例 \`postEnsure\` 生成。若你希望减少重复，可改用目录级模式：\`FIGMA_CACHE_ADAPTER_DOC_MODE=cache-root\`。

- **设计事实来源**（勿改写成框架代码）：同目录 \`raw.json\`、\`spec.md\`、\`state-map.md\`、\`meta.json\`
- cacheKey: \`${ctx.cacheKey}\`
- fileKey: \`${ctx.fileKey}\`
- nodeId: \`${nodeLabel}\`
- 全局映射契约：\`${ADAPTER_CONTRACT_REL}\`

**流程 / 交互总览（可选）**：若使用本示例默认钩子，项目根下另有 **\`${FLOW_README_REL}\`**，随每次 \`ensure\` 追加节点小节，便于与 \`index.json\` 里的 \`flows\` 互补（人读 md，机读索引）。
`;
}

/**
 * @param {object} ctx
 */
function writeAdapterHint(ctx) {
  if (ADAPTER_DOC_MODE === "off") {
    return;
  }

  if (ADAPTER_DOC_MODE === "node") {
    const metaAbs = path.resolve(ctx.root, ctx.paths.meta);
    const nodeDir = path.dirname(metaAbs);
    const target = path.join(nodeDir, ADAPTER_DOC_BASENAME);
    writeTextByPolicy(target, buildNodeHint(ctx));
    return;
  }

  const cacheRootTarget = path.resolve(ctx.root, ADAPTER_DOC_CACHE_REL);
  writeTextByPolicy(cacheRootTarget, buildCacheRootHint(ctx));
}

/**
 * 保证项目存在全局 adapter contract（单一真源）。
 * 默认仅在缺失时写入，避免覆盖项目已定制内容。
 * @param {object} ctx
 */
function ensureAdapterContract(ctx) {
  const targetAbs = path.resolve(ctx.root, ADAPTER_CONTRACT_REL);
  if (fs.existsSync(targetAbs)) {
    return;
  }

  const templateAbs = path.resolve(ctx.root, ADAPTER_CONTRACT_TEMPLATE_REL);
  if (!fs.existsSync(templateAbs)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.copyFileSync(templateAbs, targetAbs);
}

/**
 * 在单文件里维护「已缓存节点」登记（按 cacheKey 幂等追加），与 index.json / flows 互补：适合评审与新人阅读。
 * @param {object} ctx
 */
function appendFlowReadmeRegistry(ctx) {
  const abs = path.resolve(ctx.root, FLOW_README_REL);
  const marker = `<!-- cache-node:${ctx.cacheKey} -->`;
  const specRel = normalizePosixPath(path.relative(ctx.root, path.resolve(ctx.root, ctx.paths.spec)));
  const metaRel = normalizePosixPath(path.relative(ctx.root, path.resolve(ctx.root, ctx.paths.meta)));
  const completeness = Array.isArray(ctx.completeness) && ctx.completeness.length ? ctx.completeness.join(", ") : "-";
  const block =
    `\n${marker}\n` +
    `### \`${ctx.cacheKey}\`\n\n` +
    `- **Figma**: ${ctx.url || "-"}\n` +
    `- **syncedAt**: ${ctx.syncedAt || "-"}\n` +
    `- **source**: ${ctx.source || "-"}\n` +
    `- **completeness**: ${completeness}\n` +
    `- **spec**: \`${specRel}\` · **meta**: \`${metaRel}\`\n` +
    `- **提示**: 像素级还原以 \`spec.md\` / \`raw.json\` 为准；用户路径请维护 \`flows\` 后把 \`npm run fc:flow:mermaid\` 输出贴到下方「流程总览」。\n`;

  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const head =
      `# 设计与流程说明（示例骨架）\n\n` +
      `> 本文件由 **figma-cache.config.example.js** 的 \`postEnsure\` 自动创建并增量更新；**可整文件改写**或复制逻辑到自有 \`figma-cache.config.js\`。\n\n` +
      `## 流程总览（手填 / 或粘贴 mermaid）\n\n` +
      `用自然语言写用户路径，或粘贴 \`npm run fc:flow:mermaid -- --flow=<flowId>\` 的输出：\n\n` +
      `\`\`\`mermaid\n%% flow mermaid 输出贴此处\n\`\`\`\n\n` +
      `## 交互与边界（手填）\n\n` +
      `- 分支条件：\n` +
      `- 异常与空状态：\n\n` +
      `## 已从 Figma 写入缓存的节点（钩子按节点幂等追加）\n\n` +
      `${FLOW_README_REGISTRY_BEGIN}\n`;
    fs.writeFileSync(abs, head + block + "\n", "utf8");
    return;
  }

  let body = fs.readFileSync(abs, "utf8");
  if (body.includes(marker)) {
    return;
  }
  if (!body.includes(FLOW_README_REGISTRY_BEGIN)) {
    body =
      body.trimEnd() +
      `\n\n## 已从 Figma 写入缓存的节点（钩子按节点幂等追加）\n\n${FLOW_README_REGISTRY_BEGIN}\n`;
  }
  fs.writeFileSync(abs, body.trimEnd() + block + "\n", "utf8");
}

/**
 * @param {string} p
 * @returns {string}
 */
function normalizePosixPath(p) {
  return p.split(path.sep).join("/");
}

module.exports = {
  buildCacheRootHint,
  buildNodeHint,
  ADAPTER_DOC_BASENAME,
  ADAPTER_DOC_MODE,
  ADAPTER_DOC_CACHE_REL,
  ADAPTER_DOC_WRITE_POLICY,
  ADAPTER_CONTRACT_REL,
  ADAPTER_CONTRACT_TEMPLATE_REL,
  FLOW_README_REL,
  appendFlowReadmeRegistry,
  ensureAdapterContract,

  hooks: {
    /**
     * 默认实现：目录级 adapter 提示（避免节点重复）+ 全局 adapter contract（缺失时自动落地）
     * + 项目根下「流程/需求」总览骨架（单文件、幂等追加节点块）。
     * 用 Agent 生成业务方案后，可整体替换本模块逻辑。
     */
    postEnsure(ctx) {
      try {
        ensureAdapterContract(ctx);
        writeAdapterHint(ctx);
        appendFlowReadmeRegistry(ctx);
      } catch (err) {
        console.error(`[figma-cache.config] postEnsure: ${err.message}`);
      }
    },
  },
};
