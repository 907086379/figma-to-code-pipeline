#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseCli } = require("../cli-args.cjs");
const { assertProjectSetupPreflight } = require("./project-setup-preflight.cjs");

const ROOT = process.cwd();
const INGEST = path.join(__dirname, "mcp-raw-ingest.cjs");
const BIN = path.join(ROOT, "bin", "figma-cache.js");

function readUrls(values, positional) {
  const file = (values["urls-file"] || values.urlsFile || "").trim();
  if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    return fs
      .readFileSync(abs, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }
  return positional.filter((u) => /^https?:\/\//i.test(u));
}

function readBatchJson(values) {
  const jf = (values["batch-json"] || values.batchJson || "").trim();
  if (!jf) return null;
  const abs = path.isAbsolute(jf) ? jf : path.join(ROOT, jf);
  const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("--batch-json must be a JSON array");
  }
  return raw;
}

function mcpRawExists(cacheDirRel, fileKey, nodeIdColon) {
  const dash = String(nodeIdColon).replace(/:/g, "-");
  const manifest = path.join(
    ROOT,
    cacheDirRel,
    "files",
    fileKey,
    "nodes",
    dash,
    "mcp-raw",
    "mcp-raw-manifest.json",
  );
  return fs.existsSync(manifest);
}

function parseCacheKeyFromUrl(url) {
  const u = new URL(url);
  const m = u.pathname.match(/\/(file|design)\/([^/]+)/i);
  const fileKey = m ? m[2] : "";
  const nodeRaw = u.searchParams.get("node-id") || "";
  const nodeColon = nodeRaw.replace(/-/g, ":");
  return { fileKey, nodeIdColon: nodeColon };
}

function runIngestStdin(url, payload, quiet) {
  const args = [INGEST];
  if (quiet) args.push("--quiet");
  args.push("--stdin", `--url=${url}`);
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "inherit", "inherit"],
  });
  return r.status ?? 1;
}

function main() {
  const { values, flags, positional } = parseCli(process.argv, {
    strings: ["urls-file", "batch-json", "cache-dir"],
    booleanFlags: ["quiet", "skip-existing", "require-project-setup", "no-validate", "help"],
  });

  if (flags.help) {
    console.log(`
Usage:
  node scripts/workflow/mcp-cache-batch.cjs [--quiet] [--skip-existing] [--require-project-setup] \\
    --urls-file=urls.txt
  node scripts/workflow/mcp-cache-batch.cjs --batch-json=payloads.json

batch-json array items: { "url": "...", "get_design_context": "...", "get_metadata": "...", "get_variable_defs": {} }

Does NOT call Figma MCP — Agent must supply MCP payloads in batch-json or pre-run ingest per URL.
`);
    process.exit(0);
  }

  const quiet = !!flags.quiet;
  const cacheDirRel = (values["cache-dir"] || process.env.FIGMA_CACHE_DIR || "figma-cache").trim();

  if (flags["require-project-setup"] || process.env.FIGMA_CACHE_REQUIRE_PROJECT_SETUP === "1") {
    const pre = assertProjectSetupPreflight({ root: ROOT, cacheDirRel, requireComplete: true });
    if (!pre.ok) {
      console.error("mcp-cache-batch: project-setup incomplete:");
      pre.errors.forEach((e) => console.error(`- ${e}`));
      process.exit(2);
    }
  }

  const batchJson = readBatchJson(values);
  let failCount = 0;
  let okCount = 0;
  let skipCount = 0;

  if (batchJson) {
    for (const item of batchJson) {
      const url = String(item.url || "").trim();
      if (!url) {
        failCount += 1;
        console.error("- skip entry: missing url");
        continue;
      }
      const { fileKey, nodeIdColon } = parseCacheKeyFromUrl(url);
      if (
        flags["skip-existing"] &&
        fileKey &&
        nodeIdColon &&
        mcpRawExists(cacheDirRel, fileKey, nodeIdColon)
      ) {
        skipCount += 1;
        if (!quiet) console.log(`skip-existing ${fileKey}#${nodeIdColon}`);
        continue;
      }
      const code = runIngestStdin(
        url,
        {
          get_design_context: item.get_design_context ?? item.designContext,
          get_metadata: item.get_metadata ?? item.metadata,
          get_variable_defs: item.get_variable_defs ?? item.variableDefs,
        },
        quiet,
      );
      if (code === 0) okCount += 1;
      else failCount += 1;
    }
  } else {
    const urls = readUrls(values, positional);
    if (!urls.length) {
      console.error("Provide --urls-file or https:// figma URLs (use --batch-json for MCP payloads)");
      process.exit(1);
    }
    for (const url of urls) {
      const { fileKey, nodeIdColon } = parseCacheKeyFromUrl(url);
      if (
        flags["skip-existing"] &&
        fileKey &&
        nodeIdColon &&
        mcpRawExists(cacheDirRel, fileKey, nodeIdColon)
      ) {
        skipCount += 1;
        if (!quiet) console.log(`skip-existing ${fileKey}#${nodeIdColon}`);
        continue;
      }
      console.error(
        `- missing cache for ${url}: use --batch-json with MCP payloads or run fc:mcp:ingest:url after MCP`,
      );
      failCount += 1;
    }
  }

  if (!flags["no-validate"] && failCount === 0 && (okCount > 0 || skipCount > 0)) {
    const vr = spawnSync(process.execPath, [BIN, "validate"], { cwd: ROOT, stdio: "inherit" });
    if ((vr.status ?? 1) !== 0) {
      process.exit(vr.status ?? 1);
    }
  }

  if (!quiet) {
    console.log(`mcp-cache-batch: ok=${okCount} skip=${skipCount} fail=${failCount}`);
  }
  process.exit(failCount > 0 ? 2 : 0);
}

main();
