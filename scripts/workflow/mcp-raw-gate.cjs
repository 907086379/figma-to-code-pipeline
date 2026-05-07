#!/usr/bin/env node
"use strict";

/**
 * 全量门禁：validate → budget（MCP 节点）→ 可选 enrich --all。
 * **`fc:mcp:ingest` 已默认串联 validate + budget**；本命令用于 **未跑 ingest**、仅手工改了
 * `mcp-raw/` 或需对全库 `enrich --all` 的修补/批处理场景。走 ingest 时不要重复跑 gate（重复劳动）。
 *
 * Usage:
 *   pnpm run fc:mcp:gate
 *   pnpm run fc:mcp:gate -- --enrich
 *   pnpm run fc:mcp:gate -- --cache-dir=./figma-cache --skip-budget
 */

const path = require("path");
const { execFileSync } = require("child_process");
const { parseCli } = require("../cli-args.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const BIN = path.join(ROOT, "bin", "figma-cache.js");

function printUsage() {
  console.log(`
Usage:
  pnpm run fc:mcp:gate
  node scripts/workflow/mcp-raw-gate.cjs [options]

Steps (默认顺序):
  1) fc:validate  — 全索引与 mcp-raw 证据门禁
  2) fc:budget --mcp-only  — MCP 节点证据体量与清单（只读统计）
  3) 仅当传入 --enrich 时：fc:enrich --all（仅处理 source=figma-mcp 且证据完整的项）

Options:
  --cache-dir=<path>   设置 FIGMA_CACHE_DIR（相对当前工作目录或绝对路径）
  --enrich             通过后追加 enrich --all（重算派生 spec/raw 等，按需开启）
  --skip-budget        跳过 budget（仅 validate；CI 极速时可开）
  --help               显示本说明

退出码：任一步失败则为非 0（与 figma-cache 子命令一致）。
`);
}

function main() {
  const { values, flags, unknown } = parseCli(process.argv, {
    strings: ["cache-dir"],
    booleanFlags: ["enrich", "skip-budget", "help"],
  });

  if (flags.help || unknown.includes("--help")) {
    printUsage();
    process.exit(0);
  }
  if (unknown.length) {
    console.error(`Unknown arguments: ${unknown.join(", ")}`);
    process.exit(1);
  }

  const env = { ...process.env };
  const cd = (values["cache-dir"] || "").trim();
  if (cd) {
    env.FIGMA_CACHE_DIR = path.isAbsolute(cd) ? path.normalize(cd) : path.resolve(process.cwd(), cd);
  }

  const steps = [];

  try {
    execFileSync(process.execPath, [BIN, "validate"], {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    steps.push("validate:ok");

    if (!flags["skip-budget"]) {
      execFileSync(process.execPath, [BIN, "budget", "--mcp-only"], {
        cwd: ROOT,
        env,
        stdio: "inherit",
      });
      steps.push("budget:ok");
    }

    if (flags.enrich) {
      execFileSync(process.execPath, [BIN, "enrich", "--all"], {
        cwd: ROOT,
        env,
        stdio: "inherit",
      });
      steps.push("enrich:ok");
    }

    // 单行 JSON，便于脚本在混合 stdout 中稳定解析为「最后一行」
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        fcMcpGate: true,
        steps,
        enrich: Boolean(flags.enrich),
        skipBudget: Boolean(flags["skip-budget"]),
      })}\n`,
    );
  } catch {
    process.exit(2);
  }
}

main();
