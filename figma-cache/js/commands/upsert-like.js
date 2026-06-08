module.exports = function runUpsertLikeCommand(commandName, args, context) {
  const {
    parseTailWithCli,
    normalizeCompletenessList,
    defaultCompleteness,
    previewUpsertByUrl,
    validateMcpRawEvidence,
    buildMcpValidationDeps,
    upsertByUrl,
    ensureEntryFilesAndHook,
  } = context;

  const { values, flags, positionals } = parseTailWithCli(args, {
    strings: ["source", "completeness", "node-segment"],
    booleanFlags: ["allow-skeleton-with-figma-mcp"],
  });
  const url = positionals[0];
  if (!url) {
    console.error(
      `Usage: figma-cache ${commandName} <figmaUrl> [--source=manual] [--completeness=a,b] [--node-segment=sip] [--allow-skeleton-with-figma-mcp]`,
    );
    process.exit(1);
  }

  const source = (values.source || "").trim() || "manual";
  const allowSkeletonWithFigmaMcp = Boolean(flags["allow-skeleton-with-figma-mcp"]);
  const completenessRaw = (values.completeness || "").trim();
  const completeness = completenessRaw
    ? normalizeCompletenessList(completenessRaw.split(","))
    : [...defaultCompleteness];
  const nodeSegment =
    (values["node-segment"] || process.env.FIGMA_CACHE_NODE_SEGMENT || "").trim() || undefined;
  const upsertExtra = { source, completeness, ...(nodeSegment ? { nodeSegment } : {}) };

  const preview = previewUpsertByUrl(url, upsertExtra);
  if (source === "figma-mcp") {
    const mcpErrors = validateMcpRawEvidence(
      preview.normalized.cacheKey,
      preview.item,
      completeness,
      { allowSkeletonWithFigmaMcp },
      buildMcpValidationDeps(),
    );
    if (mcpErrors.length) {
      console.error(
        `${commandName} failed: source=figma-mcp but MCP raw evidence is incomplete`,
      );
      mcpErrors.forEach((err) => console.error(`- ${err}`));
      process.exit(2);
    }
  }

  const result = upsertByUrl(url, upsertExtra);
  if (commandName === "ensure") {
    ensureEntryFilesAndHook(result.normalized.cacheKey, result.item);
    console.log(
      JSON.stringify(
        {
          cacheKey: result.normalized.cacheKey,
          ensured: true,
          paths: result.item.paths,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        cacheKey: result.normalized.cacheKey,
        scope: result.item.scope,
        syncedAt: result.item.syncedAt,
      },
      null,
      2,
    ),
  );
};