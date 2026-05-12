#!/usr/bin/env node
"use strict";

/**
 * Windows 上 npm 常经 cmd 调起子进程；Figma 链接里的 `&m=dev` 等会被拆成独立 argv。
 * 在 parseCli 之前把 `--url=...` / `--url ...` 后的 `key=value` 片段拼回 URL（仅当已识别为含 node-id 的 figma.com 链接）。
 */

function figmaUrlBaseAllowsQueryTailCoalesce(urlPart) {
  const s = String(urlPart || "");
  return /figma\.com\//i.test(s) && /(?:\?|&)node-id=/i.test(s);
}

function isLikelyUrlQueryContinuation(token) {
  return /^[A-Za-z][A-Za-z0-9_.-]*=/.test(String(token || ""));
}

/**
 * @param {string[]} args - process.argv.slice(2)
 * @returns {string[]}
 */
function coalesceFigmaMcpIngestArgvSlice(args) {
  const input = Array.isArray(args) ? args : [];
  const result = [];
  for (let i = 0; i < input.length; i += 1) {
    const a = input[i];
    if (a === "--") {
      result.push(a, ...input.slice(i + 1));
      break;
    }
    if (a.startsWith("--url=")) {
      const base = a.slice("--url=".length);
      let merged = base;
      let j = i + 1;
      if (figmaUrlBaseAllowsQueryTailCoalesce(base)) {
        while (
          j < input.length &&
          input[j] !== "--" &&
          !input[j].startsWith("--") &&
          isLikelyUrlQueryContinuation(input[j])
        ) {
          merged += `&${input[j]}`;
          j += 1;
        }
      }
      result.push(`--url=${merged}`);
      i = j - 1;
      continue;
    }
    if (a === "--url") {
      let k = i + 1;
      while (k < input.length && input[k] === "--") k += 1;
      if (k >= input.length || input[k].startsWith("--")) {
        result.push(a);
        continue;
      }
      let u = input[k];
      let j = k + 1;
      if (figmaUrlBaseAllowsQueryTailCoalesce(u)) {
        while (
          j < input.length &&
          input[j] !== "--" &&
          !input[j].startsWith("--") &&
          isLikelyUrlQueryContinuation(input[j])
        ) {
          u += `&${input[j]}`;
          j += 1;
        }
      }
      result.push(`--url=${u}`);
      i = j - 1;
      continue;
    }
    result.push(a);
  }
  return result;
}

module.exports = {
  coalesceFigmaMcpIngestArgvSlice,
  figmaUrlBaseAllowsQueryTailCoalesce,
  isLikelyUrlQueryContinuation,
};
