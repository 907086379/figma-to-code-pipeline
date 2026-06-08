#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseCli } = require("../cli-args.cjs");
const { assertProjectSetupPreflight } = require("./project-setup-preflight.cjs");
const {
  resolveNodeDirAbs,
  parseCacheKeyFromUrl,
  normalizeNodeIdColon,
} = require("./resolve-node-storage.cjs");

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const ROOT = process.cwd();
const INGEST = path.join(__dirname, "mcp-raw-ingest.cjs");
const BIN = path.join(PKG_ROOT, "bin", "figma-cache.js");

function resolveCacheDirAbs(cacheDirRel) {
  return path.isAbsolute(cacheDirRel) ? path.normalize(cacheDirRel) : path.join(ROOT, cacheDirRel);
}

function readManifest(manifestPath) {
  const abs = path.isAbsolute(manifestPath) ? manifestPath : path.join(ROOT, manifestPath);
  const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (Array.isArray(raw)) {
    return { schemaVersion: 1, defaultNodeSegment: undefined, items: raw };
  }
  if (raw && raw.schemaVersion === 1 && Array.isArray(raw.items)) {
    return {
      schemaVersion: 1,
      defaultNodeSegment: raw.defaultNodeSegment || raw["default-node-segment"] || undefined,
      items: raw.items,
    };
  }
  throw new Error("manifest must be schemaVersion:1 with items[] or a flat JSON array");
}

function mcpRawExists(cacheDirRel, fileKey, nodeIdColon, nodeSegment) {
  const cacheDirAbs = resolveCacheDirAbs(cacheDirRel);
  const nodeDirAbs = resolveNodeDirAbs({
    fileKey,
    nodeId: nodeIdColon,
    nodeSegment,
    cacheDirAbs,
    indexJsonPath: path.join(cacheDirAbs, "index.json"),
  });
  return fs.existsSync(path.join(nodeDirAbs, "mcp-raw", "mcp-raw-manifest.json"));
}

function itemHasMcpPayload(item) {
  const dc = item.get_design_context ?? item.designContext;
  const meta = item.get_metadata ?? item.metadata;
  const vd = item.get_variable_defs ?? item.variableDefs;
  return dc !== undefined && dc !== null && meta !== undefined && meta !== null && vd !== undefined && vd !== null;
}

function resolveItemNodeSegment(item, globalNodeSegment, defaultNodeSegment) {
  return (
    (item.nodeSegment || item["node-segment"] || globalNodeSegment || defaultNodeSegment || "").trim() ||
    undefined
  );
}

function resolveItemKeys(item, globalNodeSegment, defaultNodeSegment) {
  const url = String(item.url || "").trim();
  if (!url) {
    return { error: "missing url" };
  }
  let { fileKey, nodeIdColon } = parseCacheKeyFromUrl(url);
  if (item.nodeId || item["node-id"]) {
    nodeIdColon = normalizeNodeIdColon(item.nodeId || item["node-id"]);
  }
  if (!fileKey || !nodeIdColon) {
    return { error: `cannot resolve fileKey/nodeId from ${url}` };
  }
  const nodeSegment = resolveItemNodeSegment(item, globalNodeSegment, defaultNodeSegment);
  const label = (item.label || "").trim() || undefined;
  return { url, fileKey, nodeIdColon, nodeSegment, label };
}

function runIngestStdin(url, payload, quiet, nodeSegment, cacheDirRel, extraFlags) {
  const args = [INGEST];
  if (quiet) args.push("--quiet");
  args.push("--stdin", `--url=${url}`, `--cache-dir=${cacheDirRel}`);
  if (nodeSegment) args.push(`--node-segment=${nodeSegment}`);
  if (extraFlags.includes("no-validate")) args.push("--no-validate");
  if (extraFlags.includes("require-project-setup")) args.push("--require-project-setup");
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "inherit", "inherit"],
  });
  return r.status ?? 1;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/workflow/mcp-cache-manifest.cjs --manifest=path.json [options]

Options:
  --manifest=<path>       域清单 JSON（schemaVersion:1 或扁平数组）
  --quiet                 减少输出
  --skip-existing         ingest 时跳过已有 mcp-raw
  --gap-check-only        仅检测缺失（默认：未传 --ingest 时；不可与 --ingest 同用）
  --ingest                对含 MCP 三段的 item 执行 fc:mcp:ingest --stdin
  --no-validate           ingest 后不跑 figma-cache validate
  --cache-dir             缓存根（默认 ./figma-cache 或 FIGMA_CACHE_DIR）
  --node-segment=<name>   全局 segment；item.nodeSegment / manifest.defaultNodeSegment 可覆盖
  --require-project-setup 要求 project-setup complete

清单格式见 figma-cache/docs/README.md「域清单 manifest」。
`);
}

function main() {
  const { values, flags } = parseCli(process.argv, {
    strings: ["manifest", "cache-dir", "node-segment"],
    booleanFlags: [
      "quiet",
      "skip-existing",
      "gap-check-only",
      "ingest",
      "no-validate",
      "require-project-setup",
      "help",
    ],
  });

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  const manifestPath = (values.manifest || "").trim();
  if (!manifestPath) {
    console.error("mcp-cache-manifest: --manifest is required");
    process.exit(1);
  }

  const quiet = !!flags.quiet;
  const cacheDirRel = (values["cache-dir"] || process.env.FIGMA_CACHE_DIR || "figma-cache").trim();
  const globalNodeSegment =
    (values["node-segment"] || process.env.FIGMA_CACHE_NODE_SEGMENT || "").trim() || undefined;
  const doIngest = !!flags.ingest;
  if (doIngest && flags["gap-check-only"]) {
    console.error("mcp-cache-manifest: --ingest and --gap-check-only are mutually exclusive");
    process.exit(1);
  }
  const gapCheckOnly = !doIngest;

  if (flags["require-project-setup"] || process.env.FIGMA_CACHE_REQUIRE_PROJECT_SETUP === "1") {
    const pre = assertProjectSetupPreflight({ root: ROOT, cacheDirRel, requireComplete: true });
    if (!pre.ok) {
      console.error("mcp-cache-manifest: project-setup incomplete:");
      pre.errors.forEach((e) => console.error(`- ${e}`));
      process.exit(2);
    }
  }

  let manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (e) {
    console.error(`mcp-cache-manifest: ${e.message || e}`);
    process.exit(1);
  }

  const missing = [];
  let skipCount = 0;
  let okCount = 0;
  let failCount = 0;
  const noMcpPayload = [];

  for (const item of manifest.items) {
    const keys = resolveItemKeys(item, globalNodeSegment, manifest.defaultNodeSegment);
    if (keys.error) {
      failCount += 1;
      console.error(`- skip entry: ${keys.error}`);
      continue;
    }
    const { url, fileKey, nodeIdColon, nodeSegment, label } = keys;
    const tag = label ? `${label} ` : "";

    const exists = mcpRawExists(cacheDirRel, fileKey, nodeIdColon, nodeSegment);

    if (gapCheckOnly) {
      if (!exists) {
        missing.push({ url, nodeId: nodeIdColon, label, nodeSegment });
        if (!quiet) {
          console.error(`missing ${tag}${fileKey}#${nodeIdColon} ${url}`);
        }
      } else {
        skipCount += 1;
      }
      continue;
    }

    if (!doIngest) {
      continue;
    }

    if (flags["skip-existing"] && exists) {
      skipCount += 1;
      if (!quiet) console.log(`skip-existing ${fileKey}#${nodeIdColon}`);
      continue;
    }

    if (!itemHasMcpPayload(item)) {
      noMcpPayload.push({ url, nodeId: nodeIdColon, label });
      failCount += 1;
      console.error(`- missing MCP payload: ${tag}${url}`);
      continue;
    }

    const ingestFlags = [];
    if (flags["require-project-setup"]) {
      ingestFlags.push("require-project-setup");
    }
    // 批量 ingest 末尾统一 validate，避免每项重复跑 validate
    if (!flags["no-validate"]) {
      ingestFlags.push("no-validate");
    }
    const code = runIngestStdin(
      url,
      {
        get_design_context: item.get_design_context ?? item.designContext,
        get_metadata: item.get_metadata ?? item.metadata,
        get_variable_defs: item.get_variable_defs ?? item.variableDefs,
      },
      quiet,
      nodeSegment,
      cacheDirRel,
      ingestFlags,
    );
    if (code === 0) okCount += 1;
    else failCount += 1;
  }

  if (gapCheckOnly) {
    if (missing.length && !quiet) {
      console.error(`mcp-cache-manifest: ${missing.length} missing`);
    }
    if (!quiet) {
      console.log(`mcp-cache-manifest: gap-check ok=${skipCount} missing=${missing.length}`);
    }
    process.exit(missing.length > 0 ? 1 : 0);
  }

  if (!flags["no-validate"] && failCount === 0 && (okCount > 0 || skipCount > 0)) {
    const vr = spawnSync(process.execPath, [BIN, "validate"], {
      cwd: ROOT,
      env: { ...process.env, FIGMA_CACHE_DIR: resolveCacheDirAbs(cacheDirRel) },
      stdio: "inherit",
    });
    if ((vr.status ?? 1) !== 0) {
      process.exit(vr.status ?? 1);
    }
  }

  if (!quiet) {
    console.log(`mcp-cache-manifest: ok=${okCount} skip=${skipCount} fail=${failCount}`);
    if (noMcpPayload.length) {
      console.error(`mcp-cache-manifest: ${noMcpPayload.length} items lacked MCP fields`);
    }
  }
  process.exit(failCount > 0 ? 2 : 0);
}

main();
