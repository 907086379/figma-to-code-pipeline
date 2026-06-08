/**
 * 本仓库自用：与包内 `cursor-bootstrap/figma-cache.config.example.js` 一致（中性 postEnsure）。
 * 栈专属 Cursor 规则见 `.cursor/rules/02-figma-stack-adapter.mdc`；Vue2+Vuetify2 全文参考见 `cursor-bootstrap/examples/`。
 *
 * 工具链开发仓默认不向 `docs/figma-flow-readme.md` 追加节点（避免单测/临时缓存污染登记区）。
 */
if (process.env.FIGMA_CACHE_SKIP_FLOW_README == null) {
  process.env.FIGMA_CACHE_SKIP_FLOW_README = "1";
}
module.exports = require("./cursor-bootstrap/figma-cache.config.example.js");
