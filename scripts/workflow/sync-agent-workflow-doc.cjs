#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseCli } = require("../cli-args.cjs");

const ROOT = process.cwd();
const DEFAULT_SOURCE = "docs/figma-agent-workflow.md";

function resolveMaybeAbs(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? path.normalize(raw) : path.join(ROOT, raw);
}

function parseArgs() {
  const { values, flags, unknown } = parseCli(process.argv, {
    strings: ["source", "target"],
    booleanFlags: ["dry-run"],
  });
  return {
    source: String(values.source || "").trim() || DEFAULT_SOURCE,
    target: String(values.target || "").trim(),
    dryRun: Boolean(flags["dry-run"]),
    unknownArgs: unknown,
  };
}

function main() {
  const args = parseArgs();
  if (args.unknownArgs.length) {
    console.error(`Unknown args: ${args.unknownArgs.join(", ")}`);
    process.exit(2);
  }
  if (!args.target) {
    console.error(
      "Usage: node scripts/workflow/sync-agent-workflow-doc.cjs --target=<path> [--source=docs/figma-agent-workflow.md] [--dry-run]"
    );
    process.exit(2);
  }

  const sourceAbs = resolveMaybeAbs(args.source);
  const targetAbs = resolveMaybeAbs(args.target);
  if (!fs.existsSync(sourceAbs)) {
    console.error(`[sync-agent-workflow-doc] source not found: ${sourceAbs}`);
    process.exit(2);
  }

  const sourceText = fs.readFileSync(sourceAbs, "utf8");
  const banner = [
    "<!-- AUTO-GENERATED: DO NOT EDIT DIRECTLY -->",
    `<!-- Source: ${path.relative(ROOT, sourceAbs).replace(/\\/g, "/")} -->`,
    "",
  ].join("\n");
  const next = `${banner}${sourceText.replace(/^\uFEFF/, "")}`;
  const before = fs.existsSync(targetAbs) ? fs.readFileSync(targetAbs, "utf8") : "";
  const changed = before !== next;

  if (!args.dryRun && changed) {
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.writeFileSync(targetAbs, next, "utf8");
  }

  console.log(
    `[sync-agent-workflow-doc] ${changed ? "updated" : "unchanged"} target=${targetAbs} dryRun=${args.dryRun ? "1" : "0"}`
  );
}

main();
