#!/usr/bin/env node
"use strict";

/**
 * 共享 CLI 解析：支持 --key=value、--key <value>（中间可穿插 pnpm 注入的 `--`）、以及位置参数收集。
 * 未知长选项进入 unknown，便于调用方硬失败或降级。
 *
 * 已接入（scripts 下）：forbidden-markup-check、ui-1to1-audit、cross-project-e2e、batch-add/remove、
 * generate-icon-insets(+batch)、archive-artifacts、batch-add、auto-link-related、apply-auto-related、
 * mcp-raw-ingest、mcp-raw-gate、repair-mcp-design-context-evidence、merge-figma-geometry-metrics、ui-icon-rewrite、
 * ui-preflight、ui-report-aggregate、ui-auto-acceptance、check-ui-adapter-contract、ui-icon-registry-sync、
 * mobile/generate-mobile-spec。
 */

/**
 * @param {string[]} processArgv - 通常为 process.argv
 * @param {{
 *   strings?: string[],
 *   arrays?: string[],
 *   booleanFlags?: string[],
 * }} spec - 合法键名（不含前导 `--`）；arrays 键允许多次出现（--file=a --file=b）
 * @returns {{
 *   values: Record<string, string>,
 *   arrays: Record<string, string[]>,
 *   flags: Record<string, boolean>,
 *   positionals: string[],
 *   unknown: string[],
 * }}
 */
function parseCli(processArgv, spec) {
  const strings = new Set(spec.strings || []);
  const arrays = new Set(spec.arrays || []);
  const booleanFlags = new Set(spec.booleanFlags || []);
  /** @type {Record<string, string>} */
  const values = Object.create(null);
  /** @type {Record<string, string[]>} */
  const arraysOut = Object.create(null);
  /** @type {Record<string, boolean>} */
  const flags = Object.create(null);
  strings.forEach((k) => {
    values[k] = "";
  });
  arrays.forEach((k) => {
    arraysOut[k] = [];
  });
  booleanFlags.forEach((k) => {
    flags[k] = false;
  });
  const unknown = [];
  const positionals = [];
  const args = Array.isArray(processArgv) ? processArgv.slice(2) : [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    if (booleanFlags.has(body)) {
      flags[body] = true;
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      const key = arg.slice(2, eq);
      const val = arg.slice(eq + 1).trim();
      if (arrays.has(key)) arraysOut[key].push(val);
      else if (strings.has(key)) values[key] = val;
      else unknown.push(arg);
      continue;
    }
    let j = i + 1;
    while (j < args.length && args[j] === "--") j += 1;
    const next = args[j];
    if (next && !next.startsWith("--")) {
      if (arrays.has(body)) {
        arraysOut[body].push(next.trim());
        i = j;
        continue;
      }
      if (strings.has(body)) {
        values[body] = next.trim();
        i = j;
        continue;
      }
    }
    unknown.push(arg);
  }

  return { values, arrays: arraysOut, flags, positionals, unknown };
}

module.exports = { parseCli };
