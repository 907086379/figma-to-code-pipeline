"use strict";

function runSmokeContractCheck(context) {
  const {
    assert,
    fs,
    path,
    TEST_URL,
    FILE_KEY,
    SAFE_NODE_ID,
    CACHE_KEY,
    createTempEnv,
    expectThrow,
    runWithEnv,
  } = context;

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
}

module.exports = {
  runSmokeContractCheck,
};
