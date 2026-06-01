/* eslint-disable no-console */

const { evaluateProjectSetup } = require("../project-setup");
const { runAgentRuntimeHygieneGate } = require("../../../scripts/workflow/agent-runtime-hygiene-gate.cjs");

module.exports = function handleValidate(args, context) {
  const {
    parseTailWithCli,
    readIndex,
    validateIndex,
    fs,
    path,
    root,
    cacheDir,
    normalizeIndexShape,
    normalizeCompletenessList,
    resolveMaybeAbsolutePath,
    safeReadJson,
    normalizeSlash,
    completenessToolRequirements,
    loadProjectConfig,
    getProjectConfigPath,
  } = context;

  const { flags } = parseTailWithCli(args, {
    strings: [],
    booleanFlags: ["strict-project", "hygiene", "strict"],
  });

  const strictProject =
    Boolean(flags["strict-project"]) ||
    Boolean(flags.strict) ||
    process.env.FIGMA_CACHE_STRICT_PROJECT === "1";
  const runHygiene =
    Boolean(flags.hygiene) || Boolean(flags.strict) || process.env.FIGMA_CACHE_VALIDATE_HYGIENE === "1";

  const index = readIndex();
  const errors = validateIndex(index, {
    fs,
    path,
    normalizeIndexShape,
    normalizeCompletenessList,
    resolveMaybeAbsolutePath,
    safeReadJson,
    normalizeSlash,
    completenessToolRequirements,
    loadProjectConfig,
  });

  if (strictProject) {
    const setup = evaluateProjectSetup({
      fs,
      path,
      root,
      cacheDir,
      loadProjectConfig,
      getProjectConfigPath,
    });
    if (!setup.ok) {
      errors.push(...setup.errors.map((e) => `[project-setup] ${e}`));
    }
  }

  if (runHygiene) {
    const hygiene = runAgentRuntimeHygieneGate(root, {
      cacheDir: path.relative(root, cacheDir) || "figma-cache",
    });
    if (!hygiene.ok) {
      errors.push(...hygiene.blocking.map((b) => `[agent-hygiene] ${b}`));
    }
  }

  if (!errors.length) {
    console.log("Validation passed.");
    return;
  }
  console.error("Validation failed:");
  errors.forEach((err) => console.error(`- ${err}`));
  process.exit(2);
};
