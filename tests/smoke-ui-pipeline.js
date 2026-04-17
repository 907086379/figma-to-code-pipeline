"use strict";

function runSmokeUiPipeline(context) {
  const {
    assert,
    fs,
    os,
    path,
    root,
    TEST_URL,
    FILE_KEY,
    SAFE_NODE_ID,
    CACHE_KEY,
    createTempEnv,
    ensureMcpEvidence,
    expectThrow,
    runWithEnv,
    runUiPreflight,
    runUiAudit,
  } = context;

  // ui-preflight: negative should fail when cacheKey does not exist
  {
    const { env } = createTempEnv("figma-cache-smoke-ui-preflight-missing-cache-key-");
    const contractPath = path.join(env.FIGMA_CACHE_DIR, "adapters", "ui-adapter.contract.json");
    fs.mkdirSync(path.dirname(contractPath), { recursive: true });
    fs.writeFileSync(contractPath, JSON.stringify({ tokenMappings: [], stateMappings: {} }, null, 2) + "\n", "utf8");
    const err = expectThrow(
      () => runUiPreflight(`--cacheKey=${CACHE_KEY} --contract=${contractPath}`, root, env),
      "ui-preflight should fail when cacheKey does not exist"
    );
    assert.strictEqual(err.status, 2, "ui-preflight missing cacheKey should exit with code 2");
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

    const reportPath = path.join(root, "figma-cache", "reports", "runtime", "ui-preflight-report.json");
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

    const reportPath = path.join(root, "figma-cache", "reports", "runtime", "ui-1to1-report.json");
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

}

module.exports = {
  runSmokeUiPipeline,
};
