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
 *   --no-cleanup-staging  禁用成功后删除输入 staging 目录（见下方）
 *   --materialize-staging 与 --stdin 合用：在本进程 cwd 下创建 staging-ingest-<node>/，
 *                          写入三段文件与 .fc-mcp-ingest-staging 标记；链路成功后必定删除（脚本自有目录）
 *   --staging-dir=<dir>    从目录读取三段文件（标准名 mcp-raw-get-*.txt/xml/json 或
 *                          {nodeId-dashes}-dc.txt / -meta.txt / -vd.json）；成功后默认删除
 *                          （目录名 staging-ingest-* 或含 .fc-mcp-ingest-staging 时）
 *
 * 也可用 --file-key + --node-id（11069:3124 或 11069-3124）代替 --url。
 * Windows：npm 经 cmd 时 `&m=dev` 可能被拆成独立 argv；本脚本在解析前会把后续 `key=value` 片段自动拼回 `--url`（见 `mcp-ingest-argv.cjs`）。未传 `--url` 时还可读环境变量 `FIGMA_MCP_INGEST_URL` 或 `--url-file`（单行 URL）。
 *
 * 失败时（含参数/输入校验与 gate 子进程）写入 `figma-cache/reports/runtime/mcp-ingest-failure.json` 与 `mcp-ingest-last.log`，终端一行 `fc:mcp:ingest fail ... log=... json=...`；JSON 含 `failureKind`: `preflight`（落盘前）或 `gate`（ensure/validate/budget/enrich）。
 *
 * 输入目录清理（成功后，且未 --no-cleanup-staging）：
 * - 脚本 materialize 生成的目录：凭路径 + 标记文件删除；
 * - 文件模式：三段在同一父目录下，且（目录名 staging-ingest-* 或含 .fc-mcp-ingest-staging）
 *   且位于 cwd 之下 → 删除该父目录。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { URL } = require("url");
const { parseCli } = require("../cli-args.cjs");
const { coalesceFigmaMcpIngestArgvSlice } = require("./mcp-ingest-argv.cjs");
const { assertProjectSetupPreflight } = require("./project-setup-preflight.cjs");
const { sanitizeDesignContextTextForCache } = require("../sanitize-design-context-for-cache.cjs");
const { writeMcpIngestFailureArtifact } = require("./mcp-ingest-failure-artifact.cjs");
const { resolveNodeDirAbs } = require("./resolve-node-storage.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const BIN = path.join(ROOT, "bin", "figma-cache.js");

let PIPELINE_PKG_VERSION = "unknown";
try {
  PIPELINE_PKG_VERSION = require(path.join(ROOT, "package.json")).version;
} catch (_) {
  /* ignore */
}

const DEFAULT_FILES = Object.freeze({
  get_design_context: "mcp-raw-get-design-context.txt",
  get_metadata: "mcp-raw-get-metadata.xml",
  get_variable_defs: "mcp-raw-get-variable-defs.json",
});

/** 本脚本 materialize 或约定 staging 时写入；删除前用于确认 */
const STAGING_MARKER_FILE = ".fc-mcp-ingest-staging";

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

/** @returns {string|null} 三个路径同为某一目录的直接子文件时返回该目录（已 resolve），否则 null */
function sharedParentDirIfDirectSiblings(absPathA, absPathB, absPathC) {
  const a = path.resolve(absPathA);
  const b = path.resolve(absPathB);
  const c = path.resolve(absPathC);
  const da = path.dirname(a);
  const db = path.dirname(b);
  const dc = path.dirname(c);
  if (da !== db || db !== dc) {
    return null;
  }
  return da;
}

function isStrictDescendantOfCwd(absDir, cwd) {
  const rel = path.relative(cwd, absDir);
  if (!rel || rel === ".") {
    return false;
  }
  if (path.isAbsolute(rel)) {
    return false;
  }
  return !rel.startsWith(`..${path.sep}`) && !rel.startsWith("..");
}

function isDisposableStagingIngestDir(absDir) {
  const base = path.basename(absDir);
  return /^staging-ingest-/i.test(base);
}

function hasStagingMarker(absDir) {
  return fs.existsSync(path.join(absDir, STAGING_MARKER_FILE));
}

function tryRemoveScriptOwnedStagingDir(absDir, cwd, quiet) {
  if (!absDir || !fs.existsSync(absDir)) {
    return;
  }
  if (!hasStagingMarker(absDir)) {
    console.warn("fc:mcp:ingest skip removing script staging: marker missing");
    return;
  }
  if (!isStrictDescendantOfCwd(absDir, cwd)) {
    console.warn("fc:mcp:ingest skip removing script staging: not under cwd");
    return;
  }
  try {
    fs.rmSync(absDir, { recursive: true, force: true });
    if (!quiet) {
      const rel = path.relative(cwd, absDir) || absDir;
      console.error(`fc:mcp:ingest removed script staging dir ${rel}`);
    }
  } catch (e) {
    console.warn(`fc:mcp:ingest could not remove script staging dir: ${e.message || e}`);
  }
}

function tryRemoveStagingInputDir({ sharedDir, cwd, quiet }) {
  if (!sharedDir || !fs.existsSync(sharedDir)) {
    return;
  }
  if (!isStrictDescendantOfCwd(sharedDir, cwd)) {
    return;
  }
  if (!isDisposableStagingIngestDir(sharedDir) && !hasStagingMarker(sharedDir)) {
    return;
  }
  try {
    fs.rmSync(sharedDir, { recursive: true, force: true });
    if (!quiet) {
      const rel = path.relative(cwd, sharedDir) || sharedDir;
      console.error(`fc:mcp:ingest removed input staging dir ${rel}`);
    }
  } catch (e) {
    console.warn(`fc:mcp:ingest could not remove input staging dir: ${e.message || e}`);
  }
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

function readStagingDirFiles(stagingDirAbs, nodeIdColon) {
  const stdDc = path.join(stagingDirAbs, DEFAULT_FILES.get_design_context);
  const stdMeta = path.join(stagingDirAbs, DEFAULT_FILES.get_metadata);
  const stdVd = path.join(stagingDirAbs, DEFAULT_FILES.get_variable_defs);

  if (fs.existsSync(stdDc) && fs.existsSync(stdMeta) && fs.existsSync(stdVd)) {
    return {
      designContext: fs.readFileSync(stdDc, "utf8"),
      metadata: fs.readFileSync(stdMeta, "utf8"),
      variableDefs: JSON.parse(fs.readFileSync(stdVd, "utf8")),
      stagingDirAbs,
    };
  }

  const dashed = sanitizeNodeId(nodeIdColon);
  const convDc = path.join(stagingDirAbs, `${dashed}-dc.txt`);
  const convMeta = path.join(stagingDirAbs, `${dashed}-meta.txt`);
  const convVd = path.join(stagingDirAbs, `${dashed}-vd.json`);

  if (fs.existsSync(convDc) && fs.existsSync(convMeta) && fs.existsSync(convVd)) {
    return {
      designContext: fs.readFileSync(convDc, "utf8"),
      metadata: fs.readFileSync(convMeta, "utf8"),
      variableDefs: JSON.parse(fs.readFileSync(convVd, "utf8")),
      stagingDirAbs,
    };
  }

  throw new Error(
    `staging-dir missing files: expected standard names (${DEFAULT_FILES.get_design_context}, ...) or ${dashed}-dc.txt / -meta.txt / -vd.json`,
  );
}

function pickPayload(stdinPayload, values, stagingPayload) {
  if (stagingPayload) {
    return stagingPayload;
  }
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
    ingestToolchain: {
      packageVersion: PIPELINE_PKG_VERSION,
      script: "scripts/workflow/mcp-raw-ingest.cjs",
    },
  };
}

function parseArgs(argv) {
  const { values, flags, unknown } = parseCli(argv, {
    strings: [
      "url",
      "url-file",
      "file-key",
      "node-id",
      "cache-dir",
      "mcp-server",
      "design-context-file",
      "metadata-file",
      "variable-defs-file",
      "node-segment",
      "staging-dir",
    ],
    booleanFlags: [
      "stdin",
      "no-sanitize",
      "no-ensure",
      "no-validate",
      "skip-budget",
      "enrich",
      "quiet",
      "help",
      "no-cleanup-staging",
      "materialize-staging",
      "require-project-setup",
    ],
  });
  if (flags.help || unknown.includes("--help")) {
    return { help: true, values, flags, unknown };
  }
  return { help: false, values, flags, unknown };
}

function resolveCacheDirAbsFromValues(values) {
  const cacheDirInput = (values["cache-dir"] || process.env.FIGMA_CACHE_DIR || "figma-cache").trim();
  return path.isAbsolute(cacheDirInput)
    ? path.normalize(cacheDirInput)
    : path.resolve(process.cwd(), cacheDirInput);
}

function inferCacheKeyStr(values, target) {
  if (target) {
    return `${target.fileKey}#${target.nodeId}`;
  }
  const fk = (values["file-key"] || "").trim();
  const nidRaw = (values["node-id"] || "").trim();
  if (fk && nidRaw) {
    return `${fk}#${normalizeNodeIdValue(nidRaw)}`;
  }
  return "invalid-target#-";
}

function ingestCommandLine() {
  const merged = [process.argv[0], process.argv[1], ...coalesceFigmaMcpIngestArgvSlice(process.argv.slice(2))];
  return merged
    .slice(1)
    .map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a))
    .join(" ");
}

function failPreflight({ values, target, stage, message, exitCode = 1, stdout = "" }) {
  const cacheDirAbs = resolveCacheDirAbsFromValues(values);
  const cacheKeyStr = inferCacheKeyStr(values, target);
  const rel = writeMcpIngestFailureArtifact({
    cacheDirAbs,
    cacheKeyStr,
    stage,
    exitCode,
    commandLine: ingestCommandLine(),
    stdout,
    stderr: String(message || ""),
    cwdForRelative: process.cwd(),
    failureKind: "preflight",
  });
  console.error(
    `fc:mcp:ingest fail ${cacheKeyStr} stage=${stage} exit=${exitCode} log=${rel.logPath} json=${rel.jsonPath}`,
  );
  process.exit(exitCode);
}

function resolveTargetUrl(values) {
  let urlRaw = (values.url || "").trim();
  if (!urlRaw) {
    urlRaw = (process.env.FIGMA_MCP_INGEST_URL || "").trim();
  }
  if (!urlRaw) {
    const uf = (values["url-file"] || "").trim();
    if (uf) {
      const abs = resolvePath(uf);
      if (!abs || !fs.existsSync(abs)) {
        throw new Error(`--url-file not found or empty: ${uf}`);
      }
      urlRaw = fs.readFileSync(abs, "utf8").split(/\r?\n/)[0].trim();
    }
  }
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
  throw new Error("Provide --url, or --url-file, or env FIGMA_MCP_INGEST_URL, or both --file-key and --node-id");
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
  --url-file=<path>        从文件首行读取 URL（避免 shell 对 & 拆词）；与 --url 二选一
  （环境变量 FIGMA_MCP_INGEST_URL：未传 --url 时作为 URL，同样可绕开 cmd 对 & 的解析）
  --cache-dir              缓存根目录（默认 ./figma-cache 或环境变量 FIGMA_CACHE_DIR）
  --node-segment=<name>    节点分组目录（如 sip、input）；也可用环境变量 FIGMA_CACHE_NODE_SEGMENT
  --mcp-server             写入 manifest.mcp-server（默认 user-Figma）
  --no-sanitize            不消毒 design context（默认执行 sanitize-design-context-for-cache）
  --no-ensure              只写 mcp-raw，不执行 fc:ensure
  --no-validate            不执行 fc:validate
  --skip-budget            不执行 fc:budget --mcp-only（默认在 validate 后执行）
  --enrich                 对本节点执行 fc:enrich <url>
  --no-cleanup-staging     保留输入 staging 临时目录（默认成功后删除）
  --materialize-staging    与 --stdin 合用：在 cwd 下生成 staging-ingest-<node>/ 与标记，完成后删除
  --staging-dir=<dir>      从目录读取三段 MCP 文件（标准名或 {nodeId}-dc.txt 约定）；成功后默认可清理
  --quiet                  成功时仅打印一行摘要；抑制 ensure/validate/budget/enrich 的 JSON 标准输出
  --require-project-setup  要求 figma-cache/project-setup.manifest.json 为 complete（或设 FIGMA_CACHE_REQUIRE_PROJECT_SETUP=1）
  --help                   显示本说明
`);
}

function runFigCacheChild(cliArgs, env, quiet) {
  const full = [BIN, ...cliArgs];
  const r = spawnSync(process.execPath, full, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.error) {
    return {
      ok: false,
      code: 2,
      stdout: "",
      stderr: r.error.message || String(r.error),
    };
  }
  if (r.signal) {
    return {
      ok: false,
      code: 2,
      stdout: r.stdout || "",
      stderr: `${r.stderr || ""}\nfigma-cache child signal: ${r.signal}\n`,
    };
  }
  const code = r.status;
  const out = r.stdout || "";
  const err = r.stderr || "";
  if (!quiet) {
    if (out) process.stdout.write(out);
    if (err) process.stderr.write(err);
  }
  if (code !== 0) {
    return {
      ok: false,
      code: typeof code === "number" ? code : 2,
      stdout: out,
      stderr: err,
    };
  }
  return { ok: true, code: 0, stdout: out, stderr: err };
}

function failIngest({
  cacheDirAbs,
  cacheKeyStr,
  stage,
  exitCode,
  commandLine,
  stdout,
  stderr,
}) {
  const rel = writeMcpIngestFailureArtifact({
    cacheDirAbs,
    cacheKeyStr,
    stage,
    exitCode,
    commandLine,
    stdout,
    stderr,
    cwdForRelative: process.cwd(),
    failureKind: "gate",
  });
  console.error(
    `fc:mcp:ingest fail ${cacheKeyStr} stage=${stage} exit=${exitCode} log=${rel.logPath} json=${rel.jsonPath}`,
  );
  process.exit(typeof exitCode === "number" && exitCode !== 0 ? exitCode : 2);
}

function main() {
  const coalescedArgv = [process.argv[0], process.argv[1], ...coalesceFigmaMcpIngestArgvSlice(process.argv.slice(2))];
  const parsed = parseArgs(coalescedArgv);
  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  const { values, flags, unknown } = parsed;
  if (unknown.length) {
    failPreflight({
      values,
      target: null,
      stage: "args",
      message: `Unknown arguments: ${unknown.join(", ")}`,
    });
  }

  if (flags["require-project-setup"] || process.env.FIGMA_CACHE_REQUIRE_PROJECT_SETUP === "1") {
    const cacheDirRel = (values["cache-dir"] || process.env.FIGMA_CACHE_DIR || "figma-cache").trim();
    const pre = assertProjectSetupPreflight({
      root: ROOT,
      cacheDirRel,
      requireComplete: true,
    });
    if (!pre.ok) {
      failPreflight({
        values,
        target: null,
        stage: "project-setup",
        message: pre.errors.join("; "),
      });
    }
  }

  let stdinPayload = null;
  if (flags.stdin) {
    try {
      stdinPayload = parseStdinJson(readStdinUtf8());
    } catch (e) {
      failPreflight({
        values,
        target: null,
        stage: "input",
        message: e.message || String(e),
      });
    }
  }

  let target;
  try {
    target = resolveTargetUrl(values);
  } catch (e) {
    failPreflight({
      values,
      target: null,
      stage: "target",
      message: e.message || String(e),
    });
  }

  const stagingDirInput = (values["staging-dir"] || "").trim();
  let stagingDirPayload = null;
  let stagingDirAbsFromFlag = null;
  if (stagingDirInput) {
    if (flags.stdin || flags["materialize-staging"]) {
      failPreflight({
        values,
        target,
        stage: "staging-dir",
        message: "--staging-dir cannot be combined with --stdin or --materialize-staging",
      });
    }
    stagingDirAbsFromFlag = resolvePath(stagingDirInput);
    if (!stagingDirAbsFromFlag || !fs.existsSync(stagingDirAbsFromFlag)) {
      failPreflight({
        values,
        target,
        stage: "staging-dir",
        message: `--staging-dir not found: ${stagingDirInput}`,
      });
    }
    try {
      const sp = readStagingDirFiles(stagingDirAbsFromFlag, target.nodeId);
      stagingDirPayload = {
        designContext: sp.designContext,
        metadata: sp.metadata,
        variableDefs: sp.variableDefs,
      };
      stagingDirAbsFromFlag = sp.stagingDirAbs;
    } catch (e) {
      failPreflight({
        values,
        target,
        stage: "staging-dir",
        message: e.message || String(e),
      });
    }
  }

  if (flags["materialize-staging"] && !flags.stdin) {
    failPreflight({
      values,
      target,
      stage: "materialize",
      message: "--materialize-staging requires --stdin",
    });
  }

  /** 由本脚本 --materialize-staging 创建，结束时凭标记删除 */
  let scriptOwnedStagingAbs = null;

  if (flags["materialize-staging"]) {
    if (!stdinPayload) {
      failPreflight({
        values,
        target,
        stage: "materialize",
        message: "stdin is empty; --materialize-staging needs JSON payload",
      });
    }
    const dcRaw = stdinPayload.get_design_context ?? stdinPayload.designContext;
    const metaRaw = stdinPayload.get_metadata ?? stdinPayload.metadata;
    const vdRaw = stdinPayload.get_variable_defs ?? stdinPayload.variableDefs;
    if (dcRaw === undefined || dcRaw === null || metaRaw === undefined || metaRaw === null) {
      failPreflight({
        values,
        target,
        stage: "payload",
        message:
          "stdin JSON must include get_design_context and get_metadata (or camelCase designContext, metadata)",
      });
    }
    if (vdRaw === undefined || vdRaw === null) {
      failPreflight({
        values,
        target,
        stage: "payload",
        message: "stdin JSON must include get_variable_defs (or variableDefs)",
      });
    }

    const cwd = process.cwd();
    scriptOwnedStagingAbs = path.join(cwd, `staging-ingest-${sanitizeNodeId(target.nodeId)}`);
    fs.rmSync(scriptOwnedStagingAbs, { recursive: true, force: true });
    fs.mkdirSync(scriptOwnedStagingAbs, { recursive: true });

    writeUtf8(path.join(scriptOwnedStagingAbs, DEFAULT_FILES.get_design_context), String(dcRaw));
    writeUtf8(path.join(scriptOwnedStagingAbs, DEFAULT_FILES.get_metadata), `${String(metaRaw).trimEnd()}\n`);
    let vdSerialized;
    try {
      vdSerialized = stringifyVariableDefs(vdRaw);
    } catch (e) {
      failPreflight({
        values,
        target,
        stage: "payload",
        message: e.message || String(e),
      });
    }
    writeUtf8(path.join(scriptOwnedStagingAbs, DEFAULT_FILES.get_variable_defs), vdSerialized);
    fs.writeFileSync(
      path.join(scriptOwnedStagingAbs, STAGING_MARKER_FILE),
      `${JSON.stringify({ v: 1, nodeId: target.nodeId, fileKey: target.fileKey })}\n`,
      "utf8",
    );

    stdinPayload = null;
    values["design-context-file"] = path.join(scriptOwnedStagingAbs, DEFAULT_FILES.get_design_context);
    values["metadata-file"] = path.join(scriptOwnedStagingAbs, DEFAULT_FILES.get_metadata);
    values["variable-defs-file"] = path.join(scriptOwnedStagingAbs, DEFAULT_FILES.get_variable_defs);
  }

  const cacheDirAbs = resolveCacheDirAbsFromValues(values);

  const mcpServer = (values["mcp-server"] || process.env.FIGMA_MCP_SERVER_NAME || "user-Figma").trim() || "user-Figma";

  let payload;
  try {
    payload = pickPayload(stdinPayload, values, stagingDirPayload);
  } catch (e) {
    failPreflight({
      values,
      target,
      stage: "input",
      message: e.message || String(e),
    });
  }

  let designContextText = payload.designContext;
  const metaText = `${payload.metadata.trimEnd()}\n`;
  let vdText;
  try {
    if (!flags["no-sanitize"]) {
      designContextText = sanitizeDesignContextTextForCache(designContextText);
    }
    vdText = stringifyVariableDefs(payload.variableDefs);
  } catch (e) {
    failPreflight({
      values,
      target,
      stage: "write-prep",
      message: e.message || String(e),
    });
  }

  const nodeSegment = (values["node-segment"] || process.env.FIGMA_CACHE_NODE_SEGMENT || "").trim() || undefined;
  const nodeDirAbs = resolveNodeDirAbs({
    fileKey: target.fileKey,
    nodeId: target.nodeId,
    nodeSegment,
    cacheDirAbs,
    indexJsonPath: path.join(cacheDirAbs, "index.json"),
  });
  const mcpRawDir = path.join(nodeDirAbs, "mcp-raw");

  const filesMap = { ...DEFAULT_FILES };
  const contentsByTool = {
    get_design_context: designContextText,
    get_metadata: metaText,
    get_variable_defs: vdText,
  };

  let manifest;
  try {
    writeUtf8(path.join(mcpRawDir, filesMap.get_design_context), contentsByTool.get_design_context);
    writeUtf8(path.join(mcpRawDir, filesMap.get_metadata), contentsByTool.get_metadata);
    writeUtf8(path.join(mcpRawDir, filesMap.get_variable_defs), contentsByTool.get_variable_defs);

    manifest = buildManifest({
      fileKey: target.fileKey,
      nodeIdColon: target.nodeId,
      mcpServer,
      filesMap,
      contentsByTool,
    });
    writeUtf8(path.join(mcpRawDir, "mcp-raw-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (e) {
    failPreflight({
      values,
      target,
      stage: "write",
      message: e.message || String(e),
      exitCode: 2,
    });
  }

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

  function figCacheCmd(cliArgs) {
    return [process.execPath, BIN, ...cliArgs].join(" ");
  }

  if (!flags["no-ensure"]) {
    const args = ["ensure", target.normalizedUrl, "--source=figma-mcp"];
    if (nodeSegment) {
      args.push(`--node-segment=${nodeSegment}`);
    }
    const r = runFigCacheChild(args, env, quiet);
    if (!r.ok) {
      failIngest({
        cacheDirAbs,
        cacheKeyStr,
        stage: "ensure",
        exitCode: r.code,
        commandLine: figCacheCmd(args),
        stdout: r.stdout,
        stderr: r.stderr,
      });
    }
  }

  if (!flags["no-validate"]) {
    const args = ["validate"];
    const r = runFigCacheChild(args, env, quiet);
    if (!r.ok) {
      failIngest({
        cacheDirAbs,
        cacheKeyStr,
        stage: "validate",
        exitCode: r.code,
        commandLine: figCacheCmd(args),
        stdout: r.stdout,
        stderr: r.stderr,
      });
    }
  }

  if (!flags["skip-budget"]) {
    const args = ["budget", "--mcp-only"];
    const r = runFigCacheChild(args, env, quiet);
    if (!r.ok) {
      failIngest({
        cacheDirAbs,
        cacheKeyStr,
        stage: "budget",
        exitCode: r.code,
        commandLine: figCacheCmd(args),
        stdout: r.stdout,
        stderr: r.stderr,
      });
    }
  }

  if (flags.enrich) {
    const args = ["enrich", target.normalizedUrl];
    const r = runFigCacheChild(args, env, quiet);
    if (!r.ok) {
      failIngest({
        cacheDirAbs,
        cacheKeyStr,
        stage: "enrich",
        exitCode: r.code,
        commandLine: figCacheCmd(args),
        stdout: r.stdout,
        stderr: r.stderr,
      });
    }
  }

  if (flags.quiet) {
    console.log(`fc:mcp:ingest ok ${cacheKeyStr} mcp-raw=${out.mcpRawDir}`);
  }

  if (!flags["no-cleanup-staging"]) {
    const cwd = process.cwd();
    if (scriptOwnedStagingAbs) {
      tryRemoveScriptOwnedStagingDir(scriptOwnedStagingAbs, cwd, quiet);
    } else if (stagingDirAbsFromFlag) {
      tryRemoveStagingInputDir({ sharedDir: stagingDirAbsFromFlag, cwd, quiet });
    } else if (!flags.stdin) {
      const dcIn = resolvePath(values["design-context-file"] || values.designContextFile);
      const metaIn = resolvePath(values["metadata-file"] || values.metadataFile);
      const vdIn = resolvePath(values["variable-defs-file"] || values.variableDefsFile);
      const shared = sharedParentDirIfDirectSiblings(dcIn, metaIn, vdIn);
      tryRemoveStagingInputDir({ sharedDir: shared, cwd, quiet });
    }
  }
}

main();
