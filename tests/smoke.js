"use strict";

const { execSync } = require("child_process");
const crypto = require("crypto");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { normalizeUiFacts } = require("../figma-cache/js/ui-facts-normalizer");
const { runNodeScript } = require("./helpers/script-runner");
const { runSmokeCrossProjectAndCursorInit } = require("./smoke-cross-project-and-cursor-init");
const { runSmokeUiReports } = require("./smoke-ui-reports");
const { runSmokeUiPipeline } = require("./smoke-ui-pipeline");
const { runSmokeContractCheck } = require("./smoke-contract-check");
const { runSmokeCoreBasics } = require("./smoke-core-basics");

const root = path.join(__dirname, "..");
const bin = path.join(root, "bin", "figma-cache.js");
const uiPreflightScript = path.join(root, "scripts", "ui", "ui-preflight.js");
const uiAuditScript = path.join(root, "scripts", "ui", "ui-1to1-audit.js");
const uiAggregateScript = path.join(root, "scripts", "ui", "ui-report-aggregate.js");
const uiAutoAcceptanceScript = path.join(root, "scripts", "ui", "ui-auto-acceptance.js");

const TEST_URL = "https://www.figma.com/file/abcABCd0123456789vWxyZ/x?node-id=1-2";
const FILE_KEY = "abcABCd0123456789vWxyZ";
const NODE_ID = "1:2";
const SAFE_NODE_ID = "1-2";
const CACHE_KEY = `${FILE_KEY}#${NODE_ID}`;

// Local helper layer for smoke orchestration.
function run(args, opts) {
  const next = opts || {};
  return execSync(`node "${bin}" ${args}`, {
    cwd: next.cwd || root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...next,
  });
}

function runWithEnv(args, extraEnv) {
  return run(args, {
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

function runInDir(args, cwd, extraEnv) {
  return run(args, {
    cwd,
    env: {
      ...process.env,
      ...(extraEnv || {}),
    },
  });
}

function runUiPreflight(args, cwd, extraEnv) {
  return runNodeScript(uiPreflightScript, args, cwd || root, extraEnv);
}

function runUiAudit(args, cwd, extraEnv) {
  return runNodeScript(uiAuditScript, args, cwd || root, extraEnv);
}

function runUiAggregate(args, cwd, extraEnv) {
  return runNodeScript(uiAggregateScript, args, cwd || root, extraEnv);
}

function runUiAutoAcceptance(args, cwd, extraEnv) {
  return runNodeScript(uiAutoAcceptanceScript, args, cwd || root, extraEnv);
}

function expectThrow(fn, message) {
  let error = null;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  assert.ok(error, message || "expected command to throw");
  return error;
}

function createTempEnv(prefix) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cacheDir = path.join(tempRoot, "figma-cache");
  const env = {
    FIGMA_CACHE_DIR: cacheDir,
    FIGMA_CACHE_INDEX_FILE: "index.json",
  };
  runWithEnv("init", env);
  return { tempRoot, cacheDir, env };
}

/** get_design_context body that passes validate-cli anti-skeleton checks (smoke only). */
function buildDefaultSmokeGetDesignContext(nodeId) {
  const nid = String(nodeId || "1:2");
  const lines = [];
  lines.push(
    `const imgSmokeA = "https://www.figma.com/api/mcp/asset/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";`
  );
  lines.push(
    `const imgSmokeB = "https://www.figma.com/api/mcp/asset/bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";`
  );
  lines.push(`export function SmokeFrame() {`);
  lines.push(`  return (`);
  lines.push(
    `    <div className="bg-[#111111] flex flex-col gap-2 p-4" data-node-id="${nid}" data-name="smoke-root">`
  );
  for (let i = 0; i < 12; i += 1) {
    lines.push(`      <div data-node-id="98:${100 + i}" className="content-stretch flex size-[24px]">`);
    lines.push(
      `        <img alt="" className="block max-w-none size-full" src={${
        i % 2 ? "imgSmokeB" : "imgSmokeA"
      }} />`
    );
    lines.push(`      </div>`);
  }
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`}`);
  lines.push("");
  lines.push("// fixture padding to satisfy min-bytes checks");
  lines.push(`// ${"y".repeat(1200)}`);
  return lines.join("\n");
}

function ensureMcpEvidence(cacheDir, filesOrOptions) {
  const nodeDir = path.join(cacheDir, "files", FILE_KEY, "nodes", SAFE_NODE_ID);
  const mcpRawDir = path.join(nodeDir, "mcp-raw");
  fs.mkdirSync(mcpRawDir, { recursive: true });

  const defaultFilesMap = {
    get_design_context: "mcp-raw-get-design-context.txt",
    get_metadata: "mcp-raw-get-metadata.xml",
    get_variable_defs: "mcp-raw-get-variable-defs.json",
  };
  const options =
    filesOrOptions &&
    typeof filesOrOptions === "object" &&
    !Array.isArray(filesOrOptions) &&
    (Object.prototype.hasOwnProperty.call(filesOrOptions, "files") ||
      Object.prototype.hasOwnProperty.call(filesOrOptions, "contents"))
      ? filesOrOptions
      : {};
  const filesMap =
    options.files ||
    (filesOrOptions && !options.files && !options.contents ? filesOrOptions : null) ||
    defaultFilesMap;
  const contents = options.contents || {};

  const fileHashes = {};
  const fileSizes = {};
  Object.entries(filesMap).forEach(([tool, fileName]) => {
    let content =
      Object.prototype.hasOwnProperty.call(contents, tool) ? contents[tool] : `mock evidence: ${tool}`;
    if (tool === "get_metadata") {
      content = Object.prototype.hasOwnProperty.call(contents, tool) ? contents[tool] : "<instance/>";
    } else if (tool === "get_variable_defs") {
      content = Object.prototype.hasOwnProperty.call(contents, tool) ? contents[tool] : "{}";
    } else if (tool === "get_design_context") {
      if (!Object.prototype.hasOwnProperty.call(contents, tool)) {
        content = buildDefaultSmokeGetDesignContext(NODE_ID);
      }
    }
    fs.writeFileSync(path.join(mcpRawDir, fileName), content, "utf8");
    fileHashes[tool] = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    fileSizes[tool] = Buffer.byteLength(content, "utf8");
  });
  fs.writeFileSync(
    path.join(mcpRawDir, "mcp-raw-manifest.json"),
    JSON.stringify(
      {
        mcpServer: "plugin-figma-figma",
        fileKey: FILE_KEY,
        nodeId: NODE_ID,
        files: filesMap,
        fileHashes,
        fileSizes,
      },
      null,
      2
    ),
    "utf8"
  );

  return { nodeDir, mcpRawDir };
}

const baseContext = {
  assert,
  fs,
  path,
  CACHE_KEY,
  FILE_KEY,
  SAFE_NODE_ID,
  TEST_URL,
  createTempEnv,
  expectThrow,
  runWithEnv,
};

// Module-level smoke orchestration entrypoint.
runSmokeCoreBasics({
  ...baseContext,
  NODE_ID,
  root,
  normalizeUiFacts,
  run,
  ensureMcpEvidence,
});

runSmokeContractCheck(baseContext);

runSmokeUiPipeline({
  ...baseContext,
  os,
  root,
  ensureMcpEvidence,
  runUiPreflight,
  runUiAudit,
});

runSmokeUiReports({
  assert,
  fs,
  os,
  path,
  root,
  runUiAggregate,
  runUiAutoAcceptance,
});

runSmokeCrossProjectAndCursorInit({
  assert,
  execSync,
  fs,
  os,
  path,
  root,
  expectThrow,
  runInDir
});

console.log("smoke: ok");