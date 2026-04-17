"use strict";

function runSmokeCoreBasics(context) {
  const {
    assert,
    fs,
    path,
    TEST_URL,
    FILE_KEY,
    NODE_ID,
    SAFE_NODE_ID,
    CACHE_KEY,
    root,
    normalizeUiFacts,
    run,
    runWithEnv,
    createTempEnv,
    ensureMcpEvidence,
    expectThrow,
  } = context;

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
      runWithEnv(`upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens`, env).trim()
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

    runWithEnv(`upsert "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions`, env);
    runWithEnv(`ensure "${TEST_URL}" --source=figma-mcp --completeness=layout,text,tokens,interactions`, env);

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
    assert.ok(!/待补充|待完善|待确认/i.test(nextStateMap), "state-map.md placeholder should be hydrated");
    assert.ok(!/待补充|待完善|待确认/i.test(nextRaw), "raw.json placeholder should be hydrated");

    runWithEnv("validate", env);
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
}

module.exports = {
  runSmokeCoreBasics,
};
