#!/usr/bin/env node
"use strict";

/**
 * 将 Figma MCP 三类原始回包写入 figma-cache 约定的 mcp-raw/，生成 manifest（sha256/size），
 * 并默认串联 fc:ensure → fc:validate → fc:budget --mcp-only；可选 --enrich（当前节点 enrich）。
 *
 * MCP 调用仍须在 Cursor/宿主内完成；本脚本负责「落盘 + 哈希 + 索引 + 校验」的稳定骨架，避免 Agent 在长对话里手写大段内容与 manifest。
 *
 * Usage:
 *   node scripts/workflow/mcp-raw-ingest.cjs --url="<figma-url-with-node-id>" \
 *     --design-context-file=tmp/get_design_context.txt \
 *     --metadata-file=tmp/get_metadata.xml \
 *     --variable-defs-file=tmp/get_variable_defs.json
 *
 *   # 或从 stdin 读 JSON（键名可用 snake_case 或 camelCase）：
 *   node scripts/workflow/mcp-raw-ingest.cjs --stdin --url="..." < payload.json
 *
 * Options:
 *   --quiet               成功时一行摘要；子命令 stdout 不刷屏（Agent/终端省 token）
 *   --cache-dir=<dir>     覆盖 FIGMA_CACHE_DIR（默认 ./figma-cache，相对当前工作目录）
 *   --mcp-server=<name>   写入 manifest.mcpServer（默认 user-Figma）
 *   --no-sanitize         跳过 design context 消毒（默认会对齐 sanitize-design-context-for-cache）
 *   --no-ensure           只写 mcp-raw，不执行 ensure
 *   --no-validate         不执行 validate（仍会 ensure，除非同时 --no-ensure）
 *   --skip-budget         不执行 fc:budget --mcp-only（默认会执行）
 *   --enrich              通过后对本节点执行 fc:enrich <url>
 *
 * 也可用 --file-key + --node-id（11069:3124 或 11069-3124）代替 --url。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { URL } = require("url");
const { parseCli } = require("../cli-args.cjs");
const { sanitizeDesignContextTextForCache } = require("../sanitize-design-context-for-cache.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const BIN = path.join(ROOT, "bin", "figma-cache.js");

const DEFAULT_FILES = Object.freeze({
  get_design_context: "mcp-raw-get-design-context.txt",
  get_metadata: "mcp-raw-get-metadata.xml",
  get_variable_defs: "mcp-raw-get-variable-defs.json",
});

function normalizeNodeIdValue(nodeId) {
  const raw = String(nodeId).trim();
  const dashPattern = /^(\d+)-(\d+)$/;
  if (dashPattern.test(raw)) {
    return raw.replace(dashPattern, "$1:$2");
  }
  return raw;
}

function normalizeFigmaUrl(inputUrl) {
  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error(`Invalid URL: ${inputUrl}`);
  }
  const hostOk = /(^|\.)figma\.com$/i.test(parsed.hostname);
  if (!hostOk) {
    throw new Error(`Non-Figma domain: ${parsed.hostname}`);
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const routeType = parts[0];
  const fileKey = parts[1];
  if (!["file", "design"].includes(routeType) || !fileKey) {
    throw new Error(`Cannot extract fileKey from path: ${parsed.pathname}`);
  }
  const nodeIdRaw = parsed.searchParams.get("node-id");
  const nodeId = nodeIdRaw ? normalizeNodeIdValue(decodeURIComponent(nodeIdRaw)) : null;
  const isNodeScope = !!nodeId;
  if (!isNodeScope) {
    throw new Error("mcp-raw-ingest requires a node-scoped URL with node-id=...");
  }
  const normalizedUrl = `https://www.figma.com/file/${fileKey}/?node-id=${encodeURIComponent(nodeId)}`;
  return { fileKey, nodeId, normalizedUrl };
}

function sanitizeNodeId(nodeId) {
  return String(nodeId).replace(/:/g, "-");
}

function sha256Utf8(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function writeUtf8(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, "utf8");
}

function stringifyVariableDefs(input) {
  if (input === null || input === undefined) {
    throw new Error("get_variable_defs payload is empty");
  }
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) throw new Error("get_variable_defs string is empty");
    return `${JSON.stringify(JSON.parse(t), null, 2)}\n`;
  }
  if (typeof input === "object") {
    return `${JSON.stringify(input, null, 2)}\n`;
  }
  throw new Error("get_variable_defs must be object or JSON string");
}

function resolvePath(p) {
  const raw = String(p || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw);
}

function readStdinUtf8() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseStdinJson(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    throw new Error("stdin is empty; provide JSON with get_design_context, get_metadata, get_variable_defs");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`stdin JSON parse failed: ${e.message}`);
  }
}

function pickPayload(stdinPayload, values) {
  if (stdinPayload) {
    const dc = stdinPayload.get_design_context ?? stdinPayload.designContext;
    const meta = stdinPayload.get_metadata ?? stdinPayload.metadata;
    const vd = stdinPayload.get_variable_defs ?? stdinPayload.variableDefs;
    if (dc === undefined || dc === null || meta === undefined || meta === null) {
      throw new Error(
        "stdin JSON must include get_design_context and get_metadata (or camelCase designContext, metadata)",
      );
    }
    if (vd === undefined || vd === null) {
      throw new Error("stdin JSON must include get_variable_defs (or variableDefs)");
    }
    return {
      designContext: String(dc),
      metadata: String(meta),
      variableDefs: vd,
    };
  }

  const dcPath = resolvePath(values["design-context-file"] || values.designContextFile);
  const metaPath = resolvePath(values["metadata-file"] || values.metadataFile);
  const vdPath = resolvePath(values["variable-defs-file"] || values.variableDefsFile);

  if (!dcPath || !metaPath || !vdPath) {
    throw new Error(
      "Provide --stdin JSON or all of --design-context-file, --metadata-file, --variable-defs-file",
    );
  }

  const designContext = fs.readFileSync(dcPath, "utf8");
  const metadata = fs.readFileSync(metaPath, "utf8");
  const vdRaw = fs.readFileSync(vdPath, "utf8");
  let variableDefs;
  try {
    variableDefs = JSON.parse(vdRaw);
  } catch (e) {
    throw new Error(`variable-defs-file must be valid JSON: ${e.message}`);
  }

  return { designContext, metadata, variableDefs };
}

function buildManifest({ fileKey, nodeIdColon, mcpServer, filesMap, contentsByTool }) {
  const fileHashes = {};
  const fileSizes = {};
  Object.entries(filesMap).forEach(([tool, fileName]) => {
    const body = contentsByTool[tool];
    const text = typeof body === "string" ? body : stringifyVariableDefs(body);
    fileHashes[tool] = sha256Utf8(text);
    fileSizes[tool] = Buffer.byteLength(text, "utf8");
  });

  return {
    mcpServer,
    fileKey,
    nodeId: nodeIdColon,
    files: { ...filesMap },
    fileHashes,
    fileSizes,
    toolCalls: {
      get_design_context: 1,
      get_metadata: 1,
      get_variable_defs: 1,
    },
  };
}

function parseArgs(argv) {
  const { values, flags, unknown } = parseCli(argv, {
    strings: [
      "url",
      "file-key",
      "node-id",
      "cache-dir",
      "mcp-server",
      "design-context-file",
      "metadata-file",
      "variable-defs-file",
    ],
    booleanFlags: ["stdin", "no-sanitize", "no-ensure", "no-validate", "skip-budget", "enrich", "quiet", "help"],
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

function resolveTargetUrl(values) {
  const urlRaw = (values.url || "").trim();
  const fk = (values["file-key"] || "").trim();
  const nidRaw = (values["node-id"] || "").trim();

  if (urlRaw) {
    return normalizeFigmaUrl(urlRaw);
  }
  if (fk && nidRaw) {
    const nodeColon = normalizeNodeIdValue(nidRaw);
    const dashed = sanitizeNodeId(nodeColon);
    const synthetic = `https://www.figma.com/design/${fk}/_/dummy?node-id=${encodeURIComponent(dashed)}`;
    return normalizeFigmaUrl(synthetic);
  }
  throw new Error("Provide --url or both --file-key and --node-id");
}

function printUsage() {
  console.log(`
Usage:
  node scripts/workflow/mcp-raw-ingest.cjs --url="<figma-url?node-id=...>" \\
    --design-context-file=path/to/get_design_context.txt \\
    --metadata-file=path/to/get_metadata.xml \\
    --variable-defs-file=path/to/get_variable_defs.json

  node scripts/workflow/mcp-raw-ingest.cjs --stdin --url="..." < payload.json

Options:
  --file-key / --node-id   代替 --url（node-id 可为 12:34 或 12-34）
  --cache-dir              缓存根目录（默认 ./figma-cache 或环境变量 FIGMA_CACHE_DIR）
  --mcp-server             写入 manifest.mcp-server（默认 user-Figma）
  --no-sanitize            不消毒 design context（默认执行 sanitize-design-context-for-cache）
  --no-ensure              只写 mcp-raw，不执行 fc:ensure
  --no-validate            不执行 fc:validate
  --skip-budget            不执行 fc:budget --mcp-only（默认在 validate 后执行）
  --enrich                 对本节点执行 fc:enrich <url>
  --quiet                  成功时仅打印一行摘要；抑制 ensure/validate/budget/enrich 的 JSON 标准输出
  --help                   显示本说明
`);
}

function runFigCacheChild(cliArgs, env, quiet) {
  const full = [BIN, ...cliArgs];
  if (!quiet) {
    execFileSync(process.execPath, full, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    return;
  }
  const r = spawnSync(process.execPath, full, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.error) {
    console.error(r.error.message || String(r.error));
    process.exit(2);
  }
  if (r.signal) {
    process.stderr.write(`figma-cache child signal: ${r.signal}\n`);
    process.exit(2);
  }
  const code = r.status;
  if (code !== 0) {
    if (r.stdout) process.stderr.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(typeof code === "number" ? code : 2);
  }
}

function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  const { values, flags } = parsed;
  const stdinPayload = flags.stdin ? parseStdinJson(readStdinUtf8()) : null;

  let target;
  try {
    target = resolveTargetUrl(values);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const cacheDirInput = (values["cache-dir"] || process.env.FIGMA_CACHE_DIR || "figma-cache").trim();
  const cacheDirAbs = path.isAbsolute(cacheDirInput)
    ? path.normalize(cacheDirInput)
    : path.resolve(process.cwd(), cacheDirInput);

  const mcpServer = (values["mcp-server"] || process.env.FIGMA_MCP_SERVER_NAME || "user-Figma").trim() || "user-Figma";

  let payload;
  try {
    payload = pickPayload(stdinPayload, values);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  let designContextText = payload.designContext;
  if (!flags["no-sanitize"]) {
    designContextText = sanitizeDesignContextTextForCache(designContextText);
  }

  const metaText = `${payload.metadata.trimEnd()}\n`;
  let vdText;
  try {
    vdText = stringifyVariableDefs(payload.variableDefs);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const safeNode = sanitizeNodeId(target.nodeId);
  const mcpRawDir = path.join(cacheDirAbs, "files", target.fileKey, "nodes", safeNode, "mcp-raw");

  const filesMap = { ...DEFAULT_FILES };
  const contentsByTool = {
    get_design_context: designContextText,
    get_metadata: metaText,
    get_variable_defs: vdText,
  };

  writeUtf8(path.join(mcpRawDir, filesMap.get_design_context), contentsByTool.get_design_context);
  writeUtf8(path.join(mcpRawDir, filesMap.get_metadata), contentsByTool.get_metadata);
  writeUtf8(path.join(mcpRawDir, filesMap.get_variable_defs), contentsByTool.get_variable_defs);

  const manifest = buildManifest({
    fileKey: target.fileKey,
    nodeIdColon: target.nodeId,
    mcpServer,
    filesMap,
    contentsByTool,
  });
  writeUtf8(path.join(mcpRawDir, "mcp-raw-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const out = {
    ok: true,
    mcpRawDir: path.relative(process.cwd(), mcpRawDir) || mcpRawDir,
    cacheDir: path.relative(process.cwd(), cacheDirAbs) || cacheDirAbs,
    fileKey: target.fileKey,
    nodeId: target.nodeId,
    manifest: {
      fileHashes: manifest.fileHashes,
      fileSizes: manifest.fileSizes,
    },
  };
  const cacheKeyStr = `${target.fileKey}#${target.nodeId}`;
  if (!flags.quiet) {
    console.log(JSON.stringify(out, null, 2));
  }

  const env = {
    ...process.env,
    FIGMA_CACHE_DIR: cacheDirAbs,
  };

  const quiet = Boolean(flags.quiet);

  if (!flags["no-ensure"]) {
    runFigCacheChild(["ensure", target.normalizedUrl, "--source=figma-mcp"], env, quiet);
  }

  if (!flags["no-validate"]) {
    runFigCacheChild(["validate"], env, quiet);
  }

  if (!flags["skip-budget"]) {
    runFigCacheChild(["budget", "--mcp-only"], env, quiet);
  }

  if (flags.enrich) {
    runFigCacheChild(["enrich", target.normalizedUrl], env, quiet);
  }

  if (flags.quiet) {
    console.log(`fc:mcp:ingest ok ${cacheKeyStr} mcp-raw=${out.mcpRawDir}`);
  }
}

main();
