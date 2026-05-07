#!/usr/bin/env node
"use strict";

/**
 * 扫描磁盘上已有 mcp-raw-manifest.json 的节点，与 figma-cache/index.json 对比；
 * 可选 --apply：对「仅有磁盘、索引缺失」的节点执行 ensure（等价于 upsert + 生成派生文件）。
 *
 * Usage:
 *   node scripts/workflow/cache-index-reconcile.cjs [--cache-dir=figma-cache] [--dry-run|--apply] [--json]
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { parseCli } = require("../cli-args.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const BIN = path.join(ROOT, "bin", "figma-cache.js");

function parseArgs(argv) {
  const { values, flags, unknown } = parseCli(argv, {
    strings: ["cache-dir"],
    booleanFlags: ["dry-run", "apply", "json", "help"],
  });
  if (flags.help || unknown.includes("--help")) {
    return { help: true };
  }
  if (unknown.length) {
    console.error(`Unknown arguments: ${unknown.join(", ")}`);
    process.exit(1);
  }
  return { values, flags };
}

function printUsage() {
  console.log(`
Usage:
  node scripts/workflow/cache-index-reconcile.cjs [--cache-dir=<dir>] [--dry-run|--apply] [--json]

  --cache-dir   缓存根目录（默认 ./figma-cache 或 FIGMA_CACHE_DIR）
  --dry-run     只打印差异，不执行 ensure（默认行为与省略 --apply 相同）
  --apply       对仅有磁盘证据、索引缺失的节点执行 figma-cache ensure（upsert + 派生文件）
  --json        输出一行 JSON 摘要（便于脚本解析）

默认 dry-run。若同时传 --dry-run 与 --apply，以 --dry-run 为准（不 apply）。
`);
}

function sanitizeNodeIdFolder(nodeIdColon) {
  return String(nodeIdColon).replace(/:/g, "-");
}

function listDiskMcpNodes(cacheDirAbs) {
  const filesRoot = path.join(cacheDirAbs, "files");
  if (!fs.existsSync(filesRoot)) {
    return [];
  }
  const out = [];
  for (const fileKey of fs.readdirSync(filesRoot)) {
    const fkDir = path.join(filesRoot, fileKey);
    if (!fs.statSync(fkDir).isDirectory()) continue;
    const nodesDir = path.join(fkDir, "nodes");
    if (!fs.existsSync(nodesDir)) continue;
    for (const nodeFolder of fs.readdirSync(nodesDir)) {
      const manifestPath = path.join(nodesDir, nodeFolder, "mcp-raw", "mcp-raw-manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch {
        continue;
      }
      if (!manifest.fileKey || !manifest.nodeId) continue;
      const cacheKey = `${manifest.fileKey}#${manifest.nodeId}`;
      out.push({
        cacheKey,
        fileKey: manifest.fileKey,
        nodeId: manifest.nodeId,
        manifestPath,
      });
    }
  }
  return out;
}

function buildNodeUrl(fileKey, nodeIdColon) {
  return `https://www.figma.com/file/${fileKey}/?node-id=${encodeURIComponent(nodeIdColon)}`;
}

function readIndex(cacheDirAbs) {
  const indexPath = path.join(cacheDirAbs, "index.json");
  if (!fs.existsSync(indexPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  const { values, flags } = parsed;
  const cacheDirInput = (values["cache-dir"] || process.env.FIGMA_CACHE_DIR || "figma-cache").trim();
  const cacheDirAbs = path.isAbsolute(cacheDirInput)
    ? path.normalize(cacheDirInput)
    : path.resolve(process.cwd(), cacheDirInput);

  /** 同时传 `--dry-run` 与 `--apply` 时以安全为准：不执行 ensure（--dry-run 优先） */
  const apply = Boolean(flags.apply) && !flags["dry-run"];

  const diskNodes = listDiskMcpNodes(cacheDirAbs);

  const index = readIndex(cacheDirAbs);
  const items = index && index.items ? index.items : {};
  const indexKeys = new Set(Object.keys(items));

  const missingInIndex = diskNodes.filter((n) => !indexKeys.has(n.cacheKey));
  const missingOnDisk = [...indexKeys].filter((k) => {
    const item = items[k];
    if (!item || item.source !== "figma-mcp" || !item.nodeId) return false;
    const folder = sanitizeNodeIdFolder(item.nodeId);
    const manifestPath = path.join(
      cacheDirAbs,
      "files",
      item.fileKey,
      "nodes",
      folder,
      "mcp-raw",
      "mcp-raw-manifest.json",
    );
    return !fs.existsSync(manifestPath);
  });

  const summary = {
    cacheDir: path.relative(process.cwd(), cacheDirAbs) || cacheDirAbs,
    diskNodeCount: diskNodes.length,
    indexItemCount: indexKeys.size,
    missingInIndex: missingInIndex.map((n) => n.cacheKey),
    missingOnDiskMcpManifest: missingOnDisk,
    applied: [],
    errors: [],
  };

  function finalize() {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
    if (summary.errors.length) {
      process.exit(2);
    }
    if (missingOnDisk.length) {
      if (!flags.json) {
        console.error("fc:cache:reconcile: index references missing mcp-raw on disk (exit 3)");
      }
      process.exit(3);
    }
    process.exit(0);
  }

  if (!flags.json) {
    console.log(`fc:cache:reconcile cacheDir=${summary.cacheDir} mode=${apply ? "apply" : "dry-run"}`);
    console.log(`disk mcp-raw nodes: ${summary.diskNodeCount}, index items: ${summary.indexItemCount}`);
    if (missingInIndex.length) {
      console.log("missing in index (on disk, not in index.json):");
      missingInIndex.forEach((n) => console.log(`  - ${n.cacheKey}`));
    } else {
      console.log("missing in index: (none)");
    }
    if (missingOnDisk.length) {
      console.log("index figma-mcp items without mcp-raw manifest on disk:");
      missingOnDisk.forEach((k) => console.log(`  - ${k}`));
    }
  }

  if (!apply || !missingInIndex.length) {
    finalize();
    return;
  }

  const env = {
    ...process.env,
    FIGMA_CACHE_DIR: cacheDirAbs,
  };

  for (const node of missingInIndex) {
    const url = buildNodeUrl(node.fileKey, node.nodeId);
    try {
      execFileSync(process.execPath, [BIN, "ensure", url, "--source=figma-mcp"], {
        cwd: ROOT,
        env,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      summary.applied.push(node.cacheKey);
    } catch (e) {
      const msg = e.stderr ? String(e.stderr) : e.message || String(e);
      summary.errors.push({ cacheKey: node.cacheKey, message: msg.slice(0, 2000) });
    }
  }

  if (!flags.json) {
    console.log("applied ensure for:");
    summary.applied.forEach((k) => console.log(`  + ${k}`));
    if (summary.errors.length) {
      console.error("errors:");
      summary.errors.forEach((err) => console.error(`  - ${err.cacheKey}: ${err.message}`));
    }
  }

  finalize();
}

main();
