#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseCli } = require("../cli-args.cjs");
const { resolveNodeDirAbs, sanitizeNodeId, normalizeNodeIdColon } = require("./resolve-node-storage.cjs");

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const ROOT = process.cwd();
const BIN = path.join(PKG_ROOT, "bin", "figma-cache.js");

let PIPELINE_PKG_VERSION = "unknown";
try {
  PIPELINE_PKG_VERSION = require(path.join(PKG_ROOT, "package.json")).version;
} catch (_) {
  /* ignore */
}

function resolveCacheDirAbs(cacheDirRel) {
  return path.isAbsolute(cacheDirRel) ? path.normalize(cacheDirRel) : path.join(ROOT, cacheDirRel);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function buildNormalizedUrl(fileKey, nodeIdColon) {
  const dashed = sanitizeNodeId(nodeIdColon);
  return `https://www.figma.com/file/${fileKey}/?node-id=${encodeURIComponent(dashed)}`;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/workflow/mcp-resegment.cjs --file-key=... --node-id=3710:5718 --node-segment=sip [options]

Options:
  --file-key=<key>           Figma file key（必填）
  --node-id=<id>             节点 ID（3710:5718 或 3710-5718，必填）
  --node-segment=<seg>       目标 segment（必填）
  --source-node-segment=<s>  源 segment；省略则用 index 回退或扁平路径
  --cache-dir                缓存根（默认 ./figma-cache）
  --force                    覆盖目标已有 mcp-raw
  --remove-source            成功后删除源节点目录（默认保留源路径便于回滚）
  --quiet                    减少输出
  --no-validate              跳过 figma-cache validate

将已有 mcp-raw/ 复制到新 segment 目录，更新 manifest.ingestToolchain，并执行 ensure + validate。
源与目标相同时为 no-op（退出 0）。默认保留源 segment/扁平路径；确认 index 已指向目标后再用 --remove-source。
`);
}

function main() {
  const { values, flags } = parseCli(process.argv, {
    strings: ["file-key", "node-id", "cache-dir", "node-segment", "source-node-segment"],
    booleanFlags: ["quiet", "force", "remove-source", "no-validate", "help"],
  });

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  const fileKey = (values["file-key"] || "").trim();
  const nodeIdRaw = (values["node-id"] || "").trim();
  const targetSegment = (values["node-segment"] || "").trim();
  const sourceSegment = (values["source-node-segment"] || "").trim() || undefined;
  const cacheDirRel = (values["cache-dir"] || process.env.FIGMA_CACHE_DIR || "figma-cache").trim();
  const quiet = !!flags.quiet;

  if (!fileKey || !nodeIdRaw || !targetSegment) {
    console.error("mcp-resegment: --file-key, --node-id, and --node-segment are required");
    process.exit(1);
  }

  const nodeIdColon = normalizeNodeIdColon(nodeIdRaw);
  const cacheDirAbs = resolveCacheDirAbs(cacheDirRel);
  const indexJsonPath = path.join(cacheDirAbs, "index.json");

  const sourceDirAbs = resolveNodeDirAbs({
    fileKey,
    nodeId: nodeIdColon,
    nodeSegment: sourceSegment,
    cacheDirAbs,
    indexJsonPath,
  });
  const targetDirAbs = resolveNodeDirAbs({
    fileKey,
    nodeId: nodeIdColon,
    nodeSegment: targetSegment,
    cacheDirAbs,
    indexJsonPath,
  });

  if (path.resolve(sourceDirAbs) === path.resolve(targetDirAbs)) {
    if (!quiet) console.log(`mcp-resegment: no-op (source equals target) ${fileKey}#${nodeIdColon}`);
    process.exit(0);
  }

  const sourceMcpRaw = path.join(sourceDirAbs, "mcp-raw");
  const targetMcpRaw = path.join(targetDirAbs, "mcp-raw");
  const sourceManifest = path.join(sourceMcpRaw, "mcp-raw-manifest.json");

  if (!fs.existsSync(sourceManifest)) {
    console.error(`mcp-resegment: source mcp-raw missing: ${path.relative(ROOT, sourceManifest)}`);
    process.exit(1);
  }

  const targetManifest = path.join(targetMcpRaw, "mcp-raw-manifest.json");
  if (fs.existsSync(targetManifest) && !flags.force) {
    console.error(
      `mcp-resegment: target mcp-raw already exists (use --force): ${path.relative(ROOT, targetMcpRaw)}`,
    );
    process.exit(1);
  }

  if (fs.existsSync(targetMcpRaw)) {
    fs.rmSync(targetMcpRaw, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(targetDirAbs), { recursive: true });
  copyDirRecursive(sourceMcpRaw, targetMcpRaw);

  const manifestPath = path.join(targetMcpRaw, "mcp-raw-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.ingestToolchain = {
    packageVersion: PIPELINE_PKG_VERSION,
    script: "scripts/workflow/mcp-resegment.cjs",
    resegmentedFrom: path.relative(cacheDirAbs, sourceDirAbs).split(path.sep).join("/"),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const normalizedUrl = buildNormalizedUrl(fileKey, nodeIdColon);
  const env = { ...process.env, FIGMA_CACHE_DIR: cacheDirAbs };
  const ensureArgs = ["ensure", normalizedUrl, "--source=figma-mcp", `--node-segment=${targetSegment}`];
  const er = spawnSync(process.execPath, [BIN, ...ensureArgs], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
  });
  if ((er.status ?? 1) !== 0) {
    console.error(`mcp-resegment: ensure failed exit=${er.status ?? 1}`);
    process.exit(er.status ?? 1);
  }

  if (!flags["no-validate"]) {
    const vr = spawnSync(process.execPath, [BIN, "validate"], {
      cwd: ROOT,
      env,
      stdio: quiet ? "pipe" : "inherit",
    });
    if ((vr.status ?? 1) !== 0) {
      console.error(`mcp-resegment: validate failed exit=${vr.status ?? 1}`);
      process.exit(vr.status ?? 1);
    }
  }

  if (flags["remove-source"] && path.resolve(sourceDirAbs) !== path.resolve(targetDirAbs)) {
    try {
      fs.rmSync(sourceDirAbs, { recursive: true, force: true });
      if (!quiet) {
        console.log(`mcp-resegment: removed source dir ${path.relative(ROOT, sourceDirAbs)}`);
      }
    } catch (e) {
      console.error(`mcp-resegment: remove-source failed: ${e.message || e}`);
      process.exit(1);
    }
  }

  if (quiet) {
    console.log(
      `mcp-resegment ok ${fileKey}#${nodeIdColon} -> ${path.relative(cacheDirAbs, targetDirAbs).split(path.sep).join("/")}`,
    );
  } else {
    console.log(`mcp-resegment: copied mcp-raw to ${path.relative(ROOT, targetDirAbs)}`);
  }
  process.exit(0);
}

main();
