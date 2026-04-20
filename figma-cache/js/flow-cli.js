/* eslint-disable no-console */

function slugifyFlowId(name) {
  const raw = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw || `flow-${Date.now()}`;
}

function normalizeNodeId(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.includes(":") ? value : value.replace(/-/g, ":");
}

function normalizeCacheKey(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  const parts = value.split("#");
  if (parts.length !== 2) return value;
  return `${parts[0]}#${normalizeNodeId(parts[1])}`;
}

function resolveCacheKeyOrUrl(input, deps) {
  const text = String(input || "").trim();
  if (!text) return { kind: "empty", cacheKey: "" };

  // Shorthand: <fileKey>#<nodeId>
  if (text.includes("#")) {
    return { kind: "cacheKey", cacheKey: normalizeCacheKey(text) };
  }

  // Shorthand: <nodeId> with default fileKey
  if (/^(?:-?\d+[:-]-?\d+)$/.test(text)) {
    const fileKey = process.env.FIGMA_DEFAULT_FILEKEY || "";
    if (fileKey) {
      return { kind: "cacheKey", cacheKey: `${fileKey}#${normalizeNodeId(text)}` };
    }
  }

  // Fallback: treat as URL
  return { kind: "url", cacheKey: deps.normalizeFigmaUrl(text).cacheKey, url: text };
}

function ensureFlow(index, flowId, meta, normalizeIndexShape) {
  const normalized = normalizeIndexShape(index);
  normalized.flows = normalized.flows || {};
  if (!normalized.flows[flowId]) {
    normalized.flows[flowId] = {
      id: flowId,
      title: meta && meta.title ? meta.title : flowId,
      description: meta && meta.description ? meta.description : "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      assumptions: [],
      openQuestions: [],
    };
  }
  return normalized.flows[flowId];
}

function upsertFlowNode(index, flowId, cacheKey, normalizeIndexShape) {
  const flow = ensureFlow(index, flowId, {}, normalizeIndexShape);
  if (!flow.nodes.includes(cacheKey)) {
    flow.nodes.push(cacheKey);
  }
  flow.updatedAt = new Date().toISOString();
}

function addFlowEdge(index, flowId, fromKey, toKey, type, note, normalizeIndexShape) {
  const flow = ensureFlow(index, flowId, {}, normalizeIndexShape);
  const edge = {
    id: `${fromKey}->${toKey}:${type}:${Date.now()}`,
    from: fromKey,
    to: toKey,
    type,
    note: note || "",
    createdAt: new Date().toISOString(),
  };
  flow.edges.push(edge);
  flow.updatedAt = new Date().toISOString();
}

function handleFlowCommand(args, deps) {
  const {
    resolveFlowIdFromArgs,
    parseCompletenessFromArgs,
    normalizeIndexShape,
    readIndex,
    writeIndex,
    normalizeFigmaUrl,
    getItem,
    upsertByUrl,
    ensureEntryFilesAndHook,
  } = deps;

  const sub = args[0];
  const rest = args.slice(1);

  if (!sub) {
    console.error("Missing flow subcommand");
    process.exit(1);
  }

  if (sub === "init") {
    const idArg = rest.find((x) => x.startsWith("--id="));
    const titleArg = rest.find((x) => x.startsWith("--title="));
    const descArg = rest.find((x) => x.startsWith("--description="));
    const flowId = idArg ? idArg.split("=")[1] : slugifyFlowId("flow");
    const title = titleArg ? titleArg.split("=").slice(1).join("=") : flowId;
    const description = descArg ? descArg.split("=").slice(1).join("=") : "";
    const index = normalizeIndexShape(readIndex());
    ensureFlow(index, flowId, { title, description }, normalizeIndexShape);
    writeIndex(index);
    console.log(JSON.stringify({ flowId, created: true }, null, 2));
    return;
  }

  if (sub === "add-node") {
    const flowId = resolveFlowIdFromArgs(rest);
    if (!flowId) {
      console.error("Missing --flow=<flowId> or env FIGMA_DEFAULT_FLOW");
      process.exit(1);
    }
    const input = rest.find((x) => !x.startsWith("--"));
    const ensureArg = rest.includes("--ensure");
    const sourceArg = rest.find((x) => x.startsWith("--source="));
    const source = sourceArg ? sourceArg.split("=")[1] : "manual";
    const { completeness } = parseCompletenessFromArgs(rest);
    const index = normalizeIndexShape(readIndex());
    const resolved = resolveCacheKeyOrUrl(input, { normalizeFigmaUrl });
    const normalized = { cacheKey: resolved.cacheKey };
    if (!ensureArg && !getItem(index, normalized.cacheKey)) {
      console.error(
        `Missing cache item for ${normalized.cacheKey}. Run fc:ensure first, or pass --ensure.`
      );
      process.exit(2);
    }
    if (ensureArg) {
      if (resolved.kind !== "url" || !resolved.url) {
        console.error(
          `flow add-node --ensure requires a Figma URL. Got shorthand "${String(input || "").trim()}".`
        );
        console.error(
          `Tip: set FIGMA_DEFAULT_FILEKEY and run fc:ensure for this node first, then re-run flow add-node without --ensure.`
        );
        process.exit(2);
      }
      upsertByUrl(resolved.url, { source, completeness });
      const refreshed = normalizeIndexShape(readIndex());
      const item = getItem(refreshed, normalized.cacheKey);
      if (item) {
        ensureEntryFilesAndHook(normalized.cacheKey, item);
      }
      Object.assign(index, refreshed);
    }
    upsertFlowNode(index, flowId, normalized.cacheKey, normalizeIndexShape);
    writeIndex(index);
    console.log(
      JSON.stringify(
        { flowId, cacheKey: normalized.cacheKey, added: true, ensured: ensureArg },
        null,
        2
      )
    );
    return;
  }

  if (sub === "link") {
    const flowId = resolveFlowIdFromArgs(rest);
    const typeArg = rest.find((x) => x.startsWith("--type="));
    const noteArg = rest.find((x) => x.startsWith("--note="));
    const urls = rest.filter((x) => !x.startsWith("--"));
    if (!flowId) {
      console.error("Missing --flow=<flowId> or env FIGMA_DEFAULT_FLOW");
      process.exit(1);
    }
    if (urls.length < 2) {
      console.error("Missing <fromUrl> <toUrl>");
      process.exit(1);
    }
    const type = typeArg ? typeArg.split("=")[1] : "related";
    const note = noteArg ? noteArg.split("=").slice(1).join("=") : "";
    const from = resolveCacheKeyOrUrl(urls[0], { normalizeFigmaUrl }).cacheKey;
    const to = resolveCacheKeyOrUrl(urls[1], { normalizeFigmaUrl }).cacheKey;
    const index = normalizeIndexShape(readIndex());
    if (!getItem(index, from) || !getItem(index, to)) {
      console.error("Missing cache item for from/to. Cache urls first with ensure/upsert.");
      process.exit(2);
    }
    upsertFlowNode(index, flowId, from, normalizeIndexShape);
    upsertFlowNode(index, flowId, to, normalizeIndexShape);
    addFlowEdge(index, flowId, from, to, type, note, normalizeIndexShape);
    writeIndex(index);
    console.log(JSON.stringify({ flowId, from, to, type, linked: true }, null, 2));
    return;
  }

  if (sub === "chain") {
    const flowId = resolveFlowIdFromArgs(rest);
    const typeArg = rest.find((x) => x.startsWith("--type="));
    const type = typeArg ? typeArg.split("=")[1] : "related";
    const urls = rest.filter((x) => !x.startsWith("--"));
    if (!flowId) {
      console.error("Missing --flow=<flowId> or env FIGMA_DEFAULT_FLOW");
      process.exit(1);
    }
    if (urls.length < 2) {
      console.error("Need at least 2 urls");
      process.exit(1);
    }
    const index = normalizeIndexShape(readIndex());
    const keys = urls.map((u) => resolveCacheKeyOrUrl(u, { normalizeFigmaUrl }).cacheKey);
    keys.forEach((k) => {
      if (!getItem(index, k)) {
        console.error(`Missing cache item for ${k}. Ensure each url is cached first.`);
        process.exit(2);
      }
    });
    keys.forEach((k) => upsertFlowNode(index, flowId, k, normalizeIndexShape));
    for (let i = 0; i < keys.length - 1; i += 1) {
      addFlowEdge(index, flowId, keys[i], keys[i + 1], type, "", normalizeIndexShape);
    }
    writeIndex(index);
    console.log(JSON.stringify({ flowId, chained: keys.length - 1, type }, null, 2));
    return;
  }

  if (sub === "show") {
    const flowId = resolveFlowIdFromArgs(rest);
    if (!flowId) {
      console.error("Missing --flow=<flowId> or env FIGMA_DEFAULT_FLOW");
      process.exit(1);
    }
    const index = normalizeIndexShape(readIndex());
    const flow = index.flows[flowId];
    console.log(JSON.stringify({ flowId, flow: flow || null }, null, 2));
    return;
  }

  if (sub === "mermaid") {
    const flowId = resolveFlowIdFromArgs(rest);
    if (!flowId) {
      console.error("Missing --flow=<flowId> or env FIGMA_DEFAULT_FLOW");
      process.exit(1);
    }
    const index = normalizeIndexShape(readIndex());
    const flow = index.flows[flowId];
    if (!flow) {
      console.error(`Unknown flow: ${flowId}`);
      process.exit(1);
    }
    const lines = ["flowchart LR"];
    (flow.edges || []).forEach((edge) => {
      const label = edge.type || "edge";
      lines.push(`  ${edge.from} -->|${label}| ${edge.to}`);
    });
    console.log(lines.join("\n"));
    return;
  }

  console.error(`Unknown flow subcommand: ${sub}`);
  process.exit(1);
}

module.exports = {
  handleFlowCommand,
};