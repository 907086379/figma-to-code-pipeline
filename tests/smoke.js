"use strict";

const { execSync } = require("child_process");
const crypto = require("crypto");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { normalizeUiFacts } = require("../figma-cache/js/ui-facts-normalizer");

const root = path.join(__dirname, "..");
const bin = path.join(root, "bin", "figma-cache.js");
const uiPreflightScript = path.join(root, "scripts", "ui-preflight.js");
const uiAuditScript = path.join(root, "scripts", "ui-1to1-audit.js");
const uiAggregateScript = path.join(root, "scripts", "ui-report-aggregate.js");
const uiAutoAcceptanceScript = path.join(root, "scripts", "ui-auto-acceptance.js");
const crossProjectE2EScript = path.join(root, "scripts", "cross-project-e2e.js");

const TEST_URL = "https://www.figma.com/file/abcABCd0123456789vWxyZ/x?node-id=1-2";
const FILE_KEY = "abcABCd0123456789vWxyZ";
const NODE_ID = "1:2";
const SAFE_NODE_ID = "1-2";
const CACHE_KEY = `${FILE_KEY}#${NODE_ID}`;

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
  const cliArgs = args ? ` ${args}` : "";
  return execSync(`node "${uiPreflightScript}"${cliArgs}`, {
    cwd: cwd || root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(extraEnv || {}),
    },
  });
}

function runUiAudit(args, cwd, extraEnv) {
  const cliArgs = args ? ` ${args}` : "";
  return execSync(`node "${uiAuditScript}"${cliArgs}`, {
    cwd: cwd || root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(extraEnv || {}),
    },
  });
}

function runUiAggregate(args, cwd, extraEnv) {
  const cliArgs = args ? ` ${args}` : "";
  return execSync(`node "${uiAggregateScript}"${cliArgs}`, {
    cwd: cwd || root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(extraEnv || {}),
    },
  });
}

function runUiAutoAcceptance(args, cwd, extraEnv) {
  const cliArgs = args ? ` ${args}` : "";
  return execSync(`node "${uiAutoAcceptanceScript}"${cliArgs}`, {
    cwd: cwd || root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(extraEnv || {}),
    },
  });
}

function runCrossProjectE2E(args, cwd, extraEnv) {
  const cliArgs = args ? ` ${args}` : "";
  return execSync(`node "${crossProjectE2EScript}"${cliArgs}`, {
    cwd: cwd || root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(extraEnv || {}),
    },
  });
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

// normalize: stable cacheKey shape
const normalized = JSON.parse(run(`normalize "${TEST_URL}"`).trim());
assert.strictEqual(normalized.fileKey, FILE_KEY);
assert.strictEqual(normalized.nodeId, NODE_ID);
assert.ok(normalized.cacheKey.includes(NODE_ID));

// config: JSON shape
const cfg = JSON.parse(run("config").trim());
assert.strictEqual(typeof cfg.normalizationVersion, "number");
assert.ok(cfg.cacheDir && cfg.indexPath);

// unknown subcommand -> non-zero exit
let exitCode = 0;
try {
  run("this-command-does-not-exist-figma-cache");
} catch (e) {
  exitCode = e.status;
}
assert.ok(exitCode > 0, "unknown command should exit non-zero");

// negative: source=figma-mcp upsert must fail without MCP evidence
{
  const { env } = createTempEnv("figma-cache-smoke-upsert-missing-");
  const err = expectThrow(
    () => runWithEnv(`upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens`, env),
    "upsert should fail when MCP raw evidence is missing"
  );
  assert.strictEqual(err.status, 2, "upsert should fail with exit code 2");
}

// negative: source=figma-mcp ensure must fail without MCP evidence
{
  const { env } = createTempEnv("figma-cache-smoke-ensure-missing-");
  const err = expectThrow(
    () => runWithEnv(`ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens`, env),
    "ensure should fail when MCP raw evidence is missing"
  );
  assert.strictEqual(err.status, 2, "ensure should fail with exit code 2");
}

// positive: source=figma-mcp upsert succeeds when evidence is complete
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-upsert-ok-");
  ensureMcpEvidence(cacheDir);
  const result = JSON.parse(
    runWithEnv(
      `upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens`,
      env
    ).trim()
  );
  assert.strictEqual(result.cacheKey, CACHE_KEY);
}

// strict evidence: truncated/omitted mcp-raw should be rejected
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-upsert-truncated-");
  ensureMcpEvidence(cacheDir, {
    contents: {
      get_design_context:
        "const x = 1;\n/* ... MCP get_design_context response omitted for brevity ... */\n",
    },
  });
  const err = expectThrow(
    () => runWithEnv(`upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens`, env),
    "upsert should fail when mcp-raw is truncated"
  );
  assert.strictEqual(err.status, 2, "upsert should fail with exit code 2");
}

// strict evidence: hash/size mismatch should be rejected
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-upsert-integrity-");
  const { mcpRawDir } = ensureMcpEvidence(cacheDir);
  const designContextPath = path.join(mcpRawDir, "mcp-raw-get-design-context.txt");
  fs.writeFileSync(designContextPath, "tampered evidence content", "utf8");
  const err = expectThrow(
    () => runWithEnv(`upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens`, env),
    "upsert should fail when hash/size integrity is broken"
  );
  assert.strictEqual(err.status, 2, "upsert should fail with exit code 2");
}

// skeleton bypass: allow-skeleton allows write, but validate must still block missing evidence
{
  const { env } = createTempEnv("figma-cache-smoke-skeleton-bypass-");
  const ensured = JSON.parse(
    runWithEnv(
      `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility --allow-skeleton-with-figma-mcp`,
      env
    ).trim()
  );
  assert.strictEqual(ensured.cacheKey, CACHE_KEY);
  assert.strictEqual(ensured.ensured, true);

  const err = expectThrow(
    () => runWithEnv("validate", env),
    "validate should fail when skeleton bypass item lacks MCP evidence"
  );
  assert.strictEqual(err.status, 2, "validate should fail with exit code 2");
}

// strict validate: completeness dimensions require non-empty coverageSummary.evidence
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-validate-evidence-");
  const { nodeDir } = ensureMcpEvidence(cacheDir);

  runWithEnv(
    `upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions`,
    env
  );
  runWithEnv(
    `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions`,
    env
  );

  const rawPath = path.join(nodeDir, "raw.json");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  raw.coverageSummary = raw.coverageSummary || {};
  raw.coverageSummary.evidence = raw.coverageSummary.evidence || {};
  raw.coverageSummary.evidence.interactions = [];
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const err = expectThrow(
    () => runWithEnv("validate", env),
    "validate should fail when completeness evidence is empty"
  );
  assert.strictEqual(err.status, 2, "validate should fail with exit code 2");
}

// strict validate: ensure should auto-hydrate TODO placeholders for figma-mcp
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-validate-todo-");
  const { nodeDir } = ensureMcpEvidence(cacheDir);

  runWithEnv(
    `upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  runWithEnv(
    `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );

  const spec = fs.readFileSync(path.join(nodeDir, "spec.md"), "utf8");
  const stateMap = fs.readFileSync(path.join(nodeDir, "state-map.md"), "utf8");
  const raw = fs.readFileSync(path.join(nodeDir, "raw.json"), "utf8");
  assert.ok(!/TODO/i.test(spec), "spec.md should be auto-hydrated for figma-mcp");
  assert.ok(!/TODO/i.test(stateMap), "state-map.md should be auto-hydrated for figma-mcp");
  assert.ok(!/TODO/i.test(raw), "raw.json notes should be auto-hydrated for figma-mcp");

  runWithEnv("validate", env);
}

// strict validate: ensure should auto-hydrate non-TODO placeholders for figma-mcp
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-validate-placeholder-cn-");
  const { nodeDir } = ensureMcpEvidence(cacheDir);

  runWithEnv(
    `upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  runWithEnv(
    `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );

  const specPath = path.join(nodeDir, "spec.md");
  const stateMapPath = path.join(nodeDir, "state-map.md");
  const rawPath = path.join(nodeDir, "raw.json");
  fs.writeFileSync(specPath, "# Figma Spec\n\n- 待补充：结构说明\n", "utf8");
  fs.writeFileSync(stateMapPath, "# State Map\n\n- 待完善：交互状态表\n", "utf8");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  raw.interactions.notes = "待补充";
  raw.states.notes = "待完善";
  raw.accessibility.notes = "待确认";
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  runWithEnv(
    `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );

  const nextSpec = fs.readFileSync(specPath, "utf8");
  const nextStateMap = fs.readFileSync(stateMapPath, "utf8");
  const nextRaw = fs.readFileSync(rawPath, "utf8");
  assert.ok(!/待补充|待完善|待确认/i.test(nextSpec), "spec.md placeholder should be hydrated");
  assert.ok(
    !/待补充|待完善|待确认/i.test(nextStateMap),
    "state-map.md placeholder should be hydrated"
  );
  assert.ok(!/待补充|待完善|待确认/i.test(nextRaw), "raw.json placeholder should be hydrated");

  runWithEnv("validate", env);
}


// contract-check: should pass with mapped token/state and fail on unmapped
{
  const { env } = createTempEnv("figma-cache-smoke-contract-check-");

  runWithEnv(
    `ensure "${TEST_URL}" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );

  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [
          {
            id: "token.blue",
            figmaToken: "Textr Team Blue/Textr Team Blue 500",
            figmaValue: "#305AFE",
            required: true,
            projectBinding: { type: "literal", value: "#305AFE" },
          },
        ],
        stateMappings: {
          select: {
            requiredStates: ["default", "expanded", "selected", "unselected"],
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  runWithEnv(`contract-check --cacheKey=${CACHE_KEY}`, {
    ...env,
    FIGMA_CACHE_ADAPTER_CONTRACT: contractPath,
  });

  runWithEnv(`contract-check --cacheKey=${CACHE_KEY} --warn-unmapped-states`, {
    ...env,
    FIGMA_CACHE_ADAPTER_CONTRACT: contractPath,
  });

  const specPath = path.join(env.FIGMA_CACHE_DIR, "files", FILE_KEY, "nodes", SAFE_NODE_ID, "spec.md");
  const originalSpec = fs.readFileSync(specPath, "utf8");
  fs.writeFileSync(specPath, `${originalSpec}\n- Custom Missing Token: #123456\n`, "utf8");

  const failErr = expectThrow(
    () =>
      runWithEnv(`contract-check --cacheKey=${CACHE_KEY} --warn-unmapped-states`, {
        ...env,
        FIGMA_CACHE_ADAPTER_CONTRACT: contractPath,
      }),
    "contract-check should fail when token mapping is missing"
  );
  assert.strictEqual(failErr.status, 2, "contract-check should fail with exit code 2");

  runWithEnv(`contract-check --cacheKey=${CACHE_KEY} --warn-unmapped-tokens --warn-unmapped-states`, {
    ...env,
    FIGMA_CACHE_ADAPTER_CONTRACT: contractPath,
  });
}

// ui-preflight: negative should fail when cacheKey does not exist
{
  const { env } = createTempEnv("figma-cache-smoke-ui-preflight-missing-key-");
  const err = expectThrow(
    () =>
      runUiPreflight("--cacheKey=missing#1-2", root, {
        ...env,
      }),
    "ui-preflight should fail when cacheKey does not exist"
  );
  assert.strictEqual(err.status, 2, "ui-preflight should fail with exit code 2");
}

// ui-preflight: negative should fail when raw evidence missing
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-ui-preflight-missing-evidence-");
  runWithEnv(
    `ensure "${TEST_URL}" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  const rawPath = path.join(cacheDir, "files", FILE_KEY, "nodes", SAFE_NODE_ID, "raw.json");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  raw.coverageSummary = raw.coverageSummary || {};
  raw.coverageSummary.evidence = {
    layout: [],
    text: [],
    tokens: [],
    interactions: [],
    states: [],
    accessibility: [],
  };
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [
          {
            id: "token.blue",
            figmaToken: "Textr Team Blue/Textr Team Blue 500",
            figmaValue: "#305AFE",
            required: true,
            projectBinding: { type: "literal", value: "#305AFE" },
          },
        ],
        stateMappings: {
          select: {
            requiredStates: ["default", "expanded", "selected", "unselected"],
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const err = expectThrow(
    () =>
      runUiPreflight(`--cacheKey=${CACHE_KEY} --contract=${contractPath}`, root, {
        ...env,
      }),
    "ui-preflight should fail when coverage evidence is missing"
  );
  assert.strictEqual(err.status, 2, "ui-preflight should fail with exit code 2");
}

// ui-preflight: positive should pass and write default report
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-ui-preflight-ok-");
  const { nodeDir } = ensureMcpEvidence(cacheDir);
  runWithEnv(
    `upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  runWithEnv(
    `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );

  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [
          {
            id: "token.blue",
            figmaToken: "Textr Team Blue/Textr Team Blue 500",
            figmaValue: "#305AFE",
            required: true,
            projectBinding: { type: "literal", value: "#305AFE" },
          },
        ],
        stateMappings: {
          select: {
            requiredStates: ["default", "expanded", "selected", "unselected"],
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const rawPath = path.join(nodeDir, "raw.json");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  raw.coverageSummary = raw.coverageSummary || {};
  raw.coverageSummary.evidence = raw.coverageSummary.evidence || {};
  raw.coverageSummary.evidence.layout = ["meta.json"];
  raw.coverageSummary.evidence.text = ["spec.md"];
  raw.coverageSummary.evidence.tokens = ["spec.md"];
  raw.coverageSummary.evidence.interactions = ["spec.md"];
  raw.coverageSummary.evidence.states = ["state-map.md"];
  raw.coverageSummary.evidence.accessibility = ["spec.md"];
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const output = runUiPreflight(`--cacheKey=${CACHE_KEY} --contract=${contractPath}`, root, env);
  const result = JSON.parse(output.trim());
  assert.strictEqual(result.ok, true, "ui-preflight should pass for complete item");

  const reportPath = path.join(root, "figma-cache", "reports", "ui-preflight-report.json");
  assert.ok(fs.existsSync(reportPath), "ui-preflight should write default report file");
}

// ui-preflight: strict profile should treat warning as blocking
{
  const { env } = createTempEnv("figma-cache-smoke-ui-preflight-strict-profile-");
  runWithEnv(
    `ensure "${TEST_URL}" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [{ figmaToken: "x", figmaValue: "#305AFE", projectBinding: { type: "literal", value: "#305AFE" } }],
        stateMappings: { select: { requiredStates: ["default"] } },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  const err = expectThrow(
    () =>
      runUiPreflight(`--cacheKey=${CACHE_KEY} --contract=${contractPath}`, root, {
        ...env,
        FIGMA_UI_PROFILE: "strict",
      }),
    "strict profile should block preflight warnings"
  );
  assert.strictEqual(err.status, 2, "strict profile warning-block should exit with code 2");
}

// ui-audit: positive should generate score report and pass default threshold
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-ui-audit-ok-");
  const { nodeDir } = ensureMcpEvidence(cacheDir);
  runWithEnv(
    `upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  runWithEnv(
    `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );

  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [
          {
            id: "token.blue",
            figmaToken: "Textr Team Blue/Textr Team Blue 500",
            figmaValue: "#305AFE",
            required: true,
            projectBinding: { type: "literal", value: "#305AFE" },
          },
        ],
        stateMappings: {
          select: {
            requiredStates: ["default", "expanded", "selected", "unselected"],
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const rawPath = path.join(nodeDir, "raw.json");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  raw.coverageSummary = raw.coverageSummary || {};
  raw.coverageSummary.evidence = raw.coverageSummary.evidence || {};
  raw.coverageSummary.evidence.layout = ["meta.json"];
  raw.coverageSummary.evidence.text = ["spec.md"];
  raw.coverageSummary.evidence.tokens = ["spec.md"];
  raw.coverageSummary.evidence.interactions = ["spec.md"];
  raw.coverageSummary.evidence.states = ["state-map.md"];
  raw.coverageSummary.evidence.accessibility = ["spec.md"];
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const output = runUiAudit(`--cacheKey=${CACHE_KEY} --contract=${contractPath} --min-score=85`, root, env);
  const result = JSON.parse(output.trim());
  assert.strictEqual(result.ok, true, "ui-audit should pass when score meets threshold");
  assert.ok(result.summary.score.total >= 85, "ui-audit score should meet threshold");
  assert.ok(result.summary.recipesTotal >= 10, "ui-audit should load recipe library");
  assert.ok(
    typeof result.summary.recipesMatchedItems === "number",
    "ui-audit should report recipe matching coverage"
  );

  const reportPath = path.join(root, "figma-cache", "reports", "ui-1to1-report.json");
  assert.ok(fs.existsSync(reportPath), "ui-audit should write default report file");
}

// ui-audit: negative should fail when threshold is too high
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-ui-audit-threshold-");
  const { nodeDir } = ensureMcpEvidence(cacheDir);
  runWithEnv(
    `upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  runWithEnv(
    `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );

  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [
          {
            id: "token.blue",
            figmaToken: "Textr Team Blue/Textr Team Blue 500",
            figmaValue: "#305AFE",
            required: true,
            projectBinding: { type: "literal", value: "#305AFE" },
          },
        ],
        stateMappings: {
          select: {
            requiredStates: ["default", "expanded", "selected", "unselected"],
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const rawPath = path.join(nodeDir, "raw.json");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  raw.coverageSummary = raw.coverageSummary || {};
  raw.coverageSummary.evidence = raw.coverageSummary.evidence || {};
  raw.coverageSummary.evidence.layout = ["meta.json"];
  raw.coverageSummary.evidence.text = ["spec.md"];
  raw.coverageSummary.evidence.tokens = ["spec.md"];
  raw.coverageSummary.evidence.interactions = ["spec.md"];
  raw.coverageSummary.evidence.states = ["state-map.md"];
  raw.coverageSummary.evidence.accessibility = ["spec.md"];
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const err = expectThrow(
    () => runUiAudit(`--cacheKey=${CACHE_KEY} --contract=${contractPath} --min-score=101`, root, env),
    "ui-audit should fail when score threshold is too high"
  );
  assert.strictEqual(err.status, 2, "ui-audit threshold failure should exit with code 2");
}

// ui-audit: strict profile should require target path
{
  const { cacheDir, env } = createTempEnv("figma-cache-smoke-ui-audit-strict-target-");
  ensureMcpEvidence(cacheDir);
  runWithEnv(
    `upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  runWithEnv(
    `ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [{ figmaToken: "x", figmaValue: "#305AFE", projectBinding: { type: "literal", value: "#305AFE" } }],
        stateMappings: { select: { requiredStates: ["default"] } },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  const err = expectThrow(
    () =>
      runUiAudit(`--cacheKey=${CACHE_KEY} --contract=${contractPath}`, root, {
        ...env,
        FIGMA_UI_PROFILE: "strict",
      }),
    "strict profile should require target path in audit"
  );
  assert.strictEqual(err.status, 2, "strict profile audit target requirement should exit with code 2");
}

// ui-facts-normalizer: should normalize cross-source facts in generic shape
{
  const facts = normalizeUiFacts({
    specText: "- Button Label\n- Brand/Primary 500: #305AFE\n",
    stateMapText: "## 状态\n| state | visual |\n| --- | --- |\n| default | blue |\n| selected | dark |\n",
    rawJson: {
      interactions: { events: ["click", "hover"], notes: "no TODO" },
      coverageSummary: { evidence: { text: ["spec.md"] } },
    },
    variableDefsJson: {
      colors: {
        primary500: "#305AFE",
      },
    },
    entryReady: true,
    evidenceReady: true,
  });
  assert.strictEqual(facts.dimensions.layoutReady, true, "normalized facts should keep layout readiness");
  assert.ok(facts.facts.tokens.length >= 1, "normalized facts should include tokens from multiple sources");
  assert.ok(facts.facts.states.includes("default"), "normalized facts should parse state rows");
  assert.ok(facts.facts.interactions.includes("click"), "normalized facts should parse interaction events");
}

// recipes: should include top-10 high-frequency component recipes
{
  const recipesDir = path.join(root, "figma-cache", "adapters", "recipes");
  const recipeFiles = fs
    .readdirSync(recipesDir)
    .filter((name) => name.endsWith(".recipe.json") || name.endsWith(".json"));
  assert.ok(recipeFiles.length >= 10, "recipe assets should cover at least top-10 component types");
}

// contract-check: should enforce layout/typography/interaction rules
{
  const { env } = createTempEnv("figma-cache-smoke-contract-rules-");
  runWithEnv(
    `ensure "${TEST_URL}" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  const nodeDir = path.join(env.FIGMA_CACHE_DIR, "files", FILE_KEY, "nodes", SAFE_NODE_ID);
  const specPath = path.join(nodeDir, "spec.md");
  const stateMapPath = path.join(nodeDir, "state-map.md");
  const rawPath = path.join(nodeDir, "raw.json");
  fs.writeFileSync(specPath, "# Spec\n- container\n- label\n", "utf8");
  fs.writeFileSync(stateMapPath, "## States\n| state | visual |\n| --- | --- |\n| default | blue |\n", "utf8");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  raw.interactions = { notes: "click to expand" };
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [
          {
            id: "token.blue",
            figmaToken: "Textr Team Blue/Textr Team Blue 500",
            figmaValue: "#305AFE",
            required: true,
            projectBinding: { type: "literal", value: "#305AFE" },
          },
        ],
        stateMappings: { select: { requiredStates: ["default"] } },
        layoutRules: [{ id: "layout.hasContainer", pattern: "container", required: true }],
        typographyRules: [{ id: "typo.hasLabel", pattern: "label", required: true }],
        interactionRules: [{ id: "interaction.hasClick", pattern: "click", required: true }],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  runWithEnv(`contract-check --cacheKey=${CACHE_KEY}`, {
    ...env,
    FIGMA_CACHE_ADAPTER_CONTRACT: contractPath,
  });

  fs.writeFileSync(specPath, "# Spec\n- only text\n", "utf8");
  const err = expectThrow(
    () =>
      runWithEnv(`contract-check --cacheKey=${CACHE_KEY}`, {
        ...env,
        FIGMA_CACHE_ADAPTER_CONTRACT: contractPath,
      }),
    "contract-check should fail when required rules are not matched"
  );
  assert.strictEqual(err.status, 2, "contract rule mismatch should exit with code 2");
}

// contract-check: should detect node override conflict with global contract
{
  const { env } = createTempEnv("figma-cache-smoke-contract-override-conflict-");
  runWithEnv(
    `ensure "${TEST_URL}" --source=manual --completeness=layout,text,tokens,interactions,states,accessibility`,
    env
  );
  const nodeDir = path.join(env.FIGMA_CACHE_DIR, "files", FILE_KEY, "nodes", SAFE_NODE_ID);
  const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(
    contractPath,
    JSON.stringify(
      {
        tokenMappings: [
          {
            id: "token.blue",
            figmaToken: "Textr Team Blue/Textr Team Blue 500",
            figmaValue: "#305AFE",
            required: true,
            projectBinding: { type: "literal", value: "#305AFE" },
          },
        ],
        stateMappings: {
          select: {
            requiredStates: ["default", "selected"],
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(nodeDir, "ui-override.json"),
    JSON.stringify(
      {
        tokenMappings: [
          {
            figmaToken: "Textr Team Blue/Textr Team Blue 500",
            figmaValue: "#305AFE",
            projectBinding: { type: "literal", value: "#123456" },
          },
        ],
        stateMappings: {
          select: {
            requiredStates: ["default"],
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  const err = expectThrow(
    () =>
      runWithEnv(`contract-check --cacheKey=${CACHE_KEY}`, {
        ...env,
        FIGMA_CACHE_ADAPTER_CONTRACT: contractPath,
      }),
    "contract-check should fail on override/global conflict"
  );
  assert.strictEqual(err.status, 2, "override conflict should exit with code 2");
}

// ui aggregate: should output quality summary json
{
  const output = runUiAggregate("", root, {});
  const report = JSON.parse(output.trim());
  assert.ok(report.metrics, "aggregate report should include metrics");
  const summaryPath = path.join(root, "figma-cache", "reports", "ui-quality-summary.json");
  assert.ok(fs.existsSync(summaryPath), "aggregate report should be written to default path");
}

// ui auto acceptance: reports-only should pass with healthy reports
{
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figma-cache-smoke-auto-accept-"));
  const preflightPath = path.join(tempRoot, "preflight.json");
  const auditPath = path.join(tempRoot, "audit.json");
  const summaryPath = path.join(tempRoot, "summary.json");
  fs.writeFileSync(
    preflightPath,
    JSON.stringify(
      {
        ok: true,
        summary: { blockingCount: 0 },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    auditPath,
    JSON.stringify(
      {
        ok: true,
        summary: {
          score: { total: 95 },
          warningCount: 0,
          diffCount: 0,
        },
        options: {
          targetPath: "src/components/Example.tsx",
        },
        warnings: [],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        trend: { status: "healthy" },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const output = runUiAutoAcceptance(
    `--reports-only --preflight-report=${preflightPath} --audit-report=${auditPath} --summary-report=${summaryPath}`,
    root,
    {}
  );
  const result = JSON.parse(output.trim());
  assert.strictEqual(result.ok, true, "auto acceptance should pass for healthy reports");
}

// package files: should include ui auto acceptance scripts for cross-project usage
{
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  assert.ok(files.includes("scripts/ui-auto-acceptance.js"), "package files should include ui-auto-acceptance script");
  assert.ok(files.includes("scripts/ui-preflight.js"), "package files should include ui-preflight script");
  assert.ok(files.includes("scripts/ui-1to1-audit.js"), "package files should include ui-audit script");
  assert.ok(files.includes("scripts/ui-report-aggregate.js"), "package files should include ui-report-aggregate script");
  assert.ok(files.includes("scripts/cross-project-e2e.js"), "package files should include cross-project-e2e script");
}

// cross-project-e2e: should fail fast when target project is missing
{
  const err = expectThrow(
    () => runCrossProjectE2E("--target=src/components/Example.tsx --cacheKey=abc#1:2", root, {}),
    "cross-project-e2e should reject missing --target-project"
  );
  assert.strictEqual(err.status, 2, "cross-project-e2e missing target-project should exit with code 2");
}

// cross-project-e2e: should fail fast when target path is missing in single mode
{
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "figma-cache-smoke-cross-target-project-"));
  const err = expectThrow(
    () => runCrossProjectE2E(`--target-project=${tempProject} --cacheKey=abc#1:2`, root, {}),
    "cross-project-e2e should reject missing --target in single mode"
  );
  assert.strictEqual(err.status, 2, "cross-project-e2e missing target should exit with code 2");
}

// cross-project-e2e: should fail when batch-file payload is empty
{
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "figma-cache-smoke-cross-batch-empty-"));
  const batchFilePath = path.join(tempProject, "batch.json");
  fs.writeFileSync(batchFilePath, "[]\n", "utf8");
  const err = expectThrow(
    () => runCrossProjectE2E(`--target-project=${tempProject} --batch-file=${batchFilePath}`, root, {}),
    "cross-project-e2e should reject empty batch-file payload"
  );
  assert.strictEqual(err.status, 2, "cross-project-e2e empty batch-file should exit with code 2");
}

// cursor init: should ensure figma-cache.config.js and cleanup safe legacy example
{
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figma-cache-smoke-cursor-init-"));
  const cacheDir = path.join(tempRoot, "figma-cache");
  const env = {
    FIGMA_CACHE_DIR: cacheDir,
    FIGMA_CACHE_INDEX_FILE: "index.json",
  };

  const legacyExamplePath = path.join(tempRoot, "figma-cache.config.example.js");
  fs.writeFileSync(
    legacyExamplePath,
    "module.exports = { hooks: { postEnsure() {} } };\n",
    "utf8"
  );

  const initOutput = runInDir("cursor init", tempRoot, env);
  const firstJson = initOutput.split(/\r?\n\r?\n/)[0];
  const initResult = JSON.parse(firstJson);
  assert.strictEqual(initResult.ok, true);

  const configPath = path.join(tempRoot, "figma-cache.config.js");
  assert.ok(fs.existsSync(configPath), "cursor init should create figma-cache.config.js");
  assert.ok(!fs.existsSync(legacyExamplePath), "cursor init should cleanup identical legacy example");

  const configBody = fs.readFileSync(configPath, "utf8");
  assert.ok(configBody.includes("module.exports"), "generated config should be valid JS module");

  const contractTemplatePath = path.join(
    tempRoot,
    "cursor-bootstrap",
    "examples",
    "ui-adapter.contract.template.json"
  );
  const preflightTemplatePath = path.join(
    tempRoot,
    "cursor-bootstrap",
    "examples",
    "ui-1to1-preflight.template.md"
  );
  const fastTemplatePath = path.join(
    tempRoot,
    "cursor-bootstrap",
    "examples",
    "ui-execution-template.fast.md"
  );
  const strictTemplatePath = path.join(
    tempRoot,
    "cursor-bootstrap",
    "examples",
    "ui-execution-template.strict.md"
  );
  const overrideTemplatePath = path.join(
    tempRoot,
    "cursor-bootstrap",
    "examples",
    "ui-override.template.json"
  );
  assert.ok(
    fs.existsSync(contractTemplatePath),
    "cursor init should copy ui-adapter contract template to project"
  );
  assert.ok(
    fs.existsSync(preflightTemplatePath),
    "cursor init should copy ui preflight template to project"
  );
  assert.ok(fs.existsSync(fastTemplatePath), "cursor init should copy fast execution template");
  assert.ok(fs.existsSync(strictTemplatePath), "cursor init should copy strict execution template");
  assert.ok(fs.existsSync(overrideTemplatePath), "cursor init should copy override template");

  const keepExistingOutput = runInDir("cursor init", tempRoot, env);
  const keepResult = JSON.parse(keepExistingOutput.split(/\r?\n\r?\n/)[0]);
  assert.ok(keepResult.skipped >= 1, "default cursor init should keep existing .cursor templates");

  const overwriteOutput = runInDir("cursor init --overwrite", tempRoot, env);
  const overwriteResult = JSON.parse(overwriteOutput.split(/\r?\n\r?\n/)[0]);
  assert.strictEqual(overwriteResult.overwrite, true, "cursor init --overwrite should enable overwrite mode");

  const forceOutput = runInDir("cursor init --force", tempRoot, env);
  const forceResult = JSON.parse(forceOutput.split(/\r?\n\r?\n/)[0]);
  assert.strictEqual(forceResult.overwrite, false, "cursor init --force should keep legacy no-overwrite behavior");

  const conflictErr = expectThrow(
    () => runInDir("cursor init --overwrite --force", tempRoot, env),
    "cursor init should reject conflicting overwrite/force flags"
  );
  assert.ok(conflictErr.status > 0, "cursor init conflict flags should exit non-zero");

  const retiredSkillDir = path.join(tempRoot, ".cursor", "skills", "ui-baseline-governance");
  fs.mkdirSync(retiredSkillDir, { recursive: true });
  fs.writeFileSync(path.join(retiredSkillDir, "SKILL.md"), "legacy skill", "utf8");

  runInDir("cursor init", tempRoot, env);
  assert.ok(
    !fs.existsSync(path.join(retiredSkillDir, "SKILL.md")),
    "cursor init should remove retired managed files from manifest"
  );
}

if (process.platform === "win32") {
  const strictErr = expectThrow(
    () =>
      execSync(
        `powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "${path.join(root, "scripts", "preflight.ps1")}" -Mode strict`,
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }
      ),
    "preflight strict should fail in Windows PowerShell host"
  );
  assert.strictEqual(strictErr.status, 2, "preflight strict should exit with code 2");
}

console.log("smoke: ok");