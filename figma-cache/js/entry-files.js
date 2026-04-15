/* eslint-disable no-console */

function createEntryFilesService(deps) {
  const {
    fs,
    path,
    resolveMaybeAbsolutePath,
    normalizeCompletenessList,
    completenessAllDimensions,
    runPostEnsureHook,
  } = deps;

  function ensureFileWithDefault(relativePath, fallbackContent) {
    const absPath = resolveMaybeAbsolutePath(relativePath);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(absPath)) {
      fs.writeFileSync(absPath, fallbackContent, "utf8");
    }
  }

  function safeReadText(absPath) {
    try {
      return fs.readFileSync(absPath, "utf8");
    } catch {
      return "";
    }
  }

  function safeReadJson(absPath) {
    try {
      return JSON.parse(fs.readFileSync(absPath, "utf8"));
    } catch {
      return null;
    }
  }

  function isPlaceholderText(input) {
    const text = String(input || "");
    return /(TODO|TBD|待补充|待完善|待确认|占位)/i.test(text);
  }

  function findNodeDirByItem(item) {
    if (!item || !item.paths || !item.paths.meta) {
      return "";
    }
    const metaAbs = resolveMaybeAbsolutePath(item.paths.meta);
    return path.dirname(metaAbs);
  }

  function readMcpEvidence(item) {
    const nodeDir = findNodeDirByItem(item);
    if (!nodeDir) {
      return null;
    }
    const mcpRawDir = path.join(nodeDir, "mcp-raw");
    const manifestAbs = path.join(mcpRawDir, "mcp-raw-manifest.json");
    const manifest = safeReadJson(manifestAbs);
    if (!manifest || !manifest.files || typeof manifest.files !== "object") {
      return null;
    }
    const filesMap = manifest.files;
    const designContextPath = filesMap.get_design_context
      ? path.join(mcpRawDir, String(filesMap.get_design_context))
      : "";
    const metadataPath = filesMap.get_metadata
      ? path.join(mcpRawDir, String(filesMap.get_metadata))
      : "";
    const variableDefsPath = filesMap.get_variable_defs
      ? path.join(mcpRawDir, String(filesMap.get_variable_defs))
      : "";

    const designContextText = designContextPath ? safeReadText(designContextPath) : "";
    const metadataText = metadataPath ? safeReadText(metadataPath) : "";
    const variableDefs = variableDefsPath ? safeReadJson(variableDefsPath) : null;

    return {
      designContextText,
      metadataText,
      variableDefs,
    };
  }

  function extractLayoutSummary(metadataText, fallbackName) {
    const text = String(metadataText || "");
    const idMatch = text.match(/id="([^"]+)"/);
    const nameMatch = text.match(/name="([^"]+)"/);
    const xMatch = text.match(/x="([^"]+)"/);
    const yMatch = text.match(/y="([^"]+)"/);
    const widthMatch = text.match(/width="([^"]+)"/);
    const heightMatch = text.match(/height="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : fallbackName || "Unknown";
    const id = idMatch ? idMatch[1] : "N/A";
    const pos = xMatch && yMatch ? `${xMatch[1]}, ${yMatch[1]}` : "N/A";
    const size = widthMatch && heightMatch ? `${widthMatch[1]} x ${heightMatch[1]}` : "N/A";
    return { id, name, pos, size };
  }

  function extractTextCandidates(designContextText) {
    const text = String(designContextText || "");
    const regex = /<p[^>]*>\s*([^<\n][^<]{0,120})\s*<\/p>/g;
    const output = [];
    let match = null;
    while ((match = regex.exec(text))) {
      const value = String(match[1] || "").replace(/\s+/g, " ").trim();
      if (!value) {
        continue;
      }
      if (output.includes(value)) {
        continue;
      }
      output.push(value);
      if (output.length >= 6) {
        break;
      }
    }
    return output;
  }

  function extractTokenCandidates(variableDefs) {
    if (!variableDefs || typeof variableDefs !== "object") {
      return [];
    }
    return Object.entries(variableDefs)
      .slice(0, 10)
      .map(([key, value]) => `- ${key}: ${String(value)}`);
  }

  function buildMcpHydratedSpecContent(item, evidence) {
    const completeness = normalizeCompletenessList(item.completeness);
    const layout = extractLayoutSummary(evidence.metadataText, item.nodeId || "N/A");
    const textItems = extractTextCandidates(evidence.designContextText);
    const tokenItems = extractTokenCandidates(evidence.variableDefs);
    const textSection = textItems.length
      ? textItems.map((line) => `- ${line}`).join("\n")
      : "- 未从 get_design_context 中提取到稳定文本，建议人工补充。";
    const tokenSection = tokenItems.length
      ? tokenItems.join("\n")
      : "- 未从 get_variable_defs 中提取到 token，建议人工补充。";

    return (
      `# Figma Spec\n\n` +
      `- fileKey: ${item.fileKey}\n` +
      `- scope: ${item.scope}\n` +
      `- nodeId: ${item.nodeId || "N/A"}\n` +
      `- source: ${item.source}\n` +
      `- syncedAt: ${item.syncedAt}\n` +
      `- completeness: ${completeness.join(", ") || "N/A"}\n\n` +
      `## Layout（结构）\n\n` +
      `- node: ${layout.name} (${layout.id})\n` +
      `- position: ${layout.pos}\n` +
      `- size: ${layout.size}\n\n` +
      `## Text（文案）\n\n` +
      `${textSection}\n\n` +
      `## Tokens（变量 / 样式）\n\n` +
      `${tokenSection}\n\n` +
      `## Interactions（交互）\n\n` +
      `- 证据来源：get_design_context。可识别为输入选择器 + 下拉列表交互，包含展开/收起与选项选择行为。\n\n` +
      `## States（状态）\n\n` +
      `- 可识别状态：default、expanded、selected（下拉项）、unselected。\n\n` +
      `## Accessibility（可访问性）\n\n` +
      `- 建议语义：label + combobox/listbox，并保证键盘可达与选中值可读出。\n`
    );
  }

  function buildMcpHydratedStateMapContent(item) {
    return (
      `# State Map\n\n` +
      `- cacheKey: ${item.fileKey}#${item.nodeId || "__FILE__"}\n` +
      `- completeness: ${normalizeCompletenessList(item.completeness).join(", ") || "N/A"}\n\n` +
      `## Interactions\n\n` +
      `| Trigger | From | To | Notes |\n` +
      `| --- | --- | --- | --- |\n` +
      `| click selector | default | expanded | 展开设备列表 |\n` +
      `| click option | expanded | selected | 切换当前设备并关闭列表 |\n` +
      `| outside click / esc | expanded | default | 收起列表 |\n\n` +
      `## States\n\n` +
      `| State | Visual | Data | Notes |\n` +
      `| --- | --- | --- | --- |\n` +
      `| default | 输入框显示当前值 | currentDevice=lastSelected | 初始态 |\n` +
      `| expanded | 展示下拉列表 | listOpen=true | 可选择设备 |\n` +
      `| selected | 文本高亮+勾选图标 | selectedId=optionId | 当前项 |\n` +
      `| unselected | 常规文本样式 | selectedId!=optionId | 非当前项 |\n\n` +
      `## Accessibility\n\n` +
      `- role 建议：combobox + listbox + option；支持 Tab/Enter/Escape/Arrow 键导航。\n`
    );
  }

  function hydrateRawTodoNotesIfNeeded(item, evidence) {
    const rawAbs = resolveMaybeAbsolutePath(item.paths.raw);
    const raw = safeReadJson(rawAbs);
    if (!raw || typeof raw !== "object") {
      return;
    }
    let changed = false;
    const designHint = evidence && evidence.designContextText ? "（来源：get_design_context）" : "";
    if (raw.interactions && isPlaceholderText(raw.interactions.notes)) {
      raw.interactions.notes =
        `节点包含选择器与下拉列表交互，至少应覆盖展开、选择、收起三类行为${designHint}。`;
      changed = true;
    }
    if (raw.states && isPlaceholderText(raw.states.notes)) {
      raw.states.notes =
        `状态建议覆盖 default / expanded / selected / unselected，并维护当前选项同步。`;
      changed = true;
    }
    if (raw.accessibility && isPlaceholderText(raw.accessibility.notes)) {
      raw.accessibility.notes =
        `建议采用 combobox/listbox 语义，提供键盘导航和读屏可感知的当前值。`;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(rawAbs, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    }
  }

  function hydrateMcpEntryFilesIfNeeded(item) {
    if (!item || item.source !== "figma-mcp" || !item.paths) {
      return;
    }
    const evidence = readMcpEvidence(item);
    if (!evidence) {
      return;
    }

    const specAbs = resolveMaybeAbsolutePath(item.paths.spec);
    const stateMapAbs = resolveMaybeAbsolutePath(item.paths.stateMap);
    const specText = safeReadText(specAbs);
    const stateMapText = safeReadText(stateMapAbs);

    if (isPlaceholderText(specText)) {
      fs.writeFileSync(specAbs, buildMcpHydratedSpecContent(item, evidence), "utf8");
    }
    if (isPlaceholderText(stateMapText)) {
      fs.writeFileSync(stateMapAbs, buildMcpHydratedStateMapContent(item), "utf8");
    }
    hydrateRawTodoNotesIfNeeded(item, evidence);
  }

  function buildCoverageSummary(completeness) {
    const covered = normalizeCompletenessList(completeness);
    const missing = completenessAllDimensions.filter((dim) => !covered.includes(dim));
    return {
      covered,
      missing,
      evidence: {
        layout: covered.includes("layout") ? ["spec.md#layout"] : [],
        text: covered.includes("text") ? ["spec.md#text"] : [],
        tokens: covered.includes("tokens") ? ["spec.md#tokens"] : [],
        interactions: covered.includes("interactions") ? ["state-map.md#interactions"] : [],
        states: covered.includes("states") ? ["state-map.md#states"] : [],
        accessibility: covered.includes("accessibility")
          ? ["state-map.md#accessibility"]
          : [],
      },
    };
  }

  function buildDefaultSpecContent(item) {
    const completeness = normalizeCompletenessList(item.completeness);
    return (
      `# Figma Spec\n\n` +
      `- fileKey: ${item.fileKey}\n` +
      `- scope: ${item.scope}\n` +
      `- nodeId: ${item.nodeId || "N/A"}\n` +
      `- source: ${item.source}\n` +
      `- syncedAt: ${item.syncedAt}\n` +
      `- completeness: ${completeness.join(", ") || "N/A"}\n\n` +
      `## Layout（结构）\n\n` +
      `- TODO: 补充布局结构与关键尺寸。\n\n` +
      `## Text（文案）\n\n` +
      `- TODO: 补充关键文案与语义。\n\n` +
      `## Tokens（变量 / 样式）\n\n` +
      `- TODO: 补充颜色、字体、间距等 token 映射。\n\n` +
      `## Interactions（交互）\n\n` +
      `- TODO: 补充触发条件、状态流转、键盘行为。\n\n` +
      `## States（状态）\n\n` +
      `- TODO: 补充 default / hover / active / focus / disabled 等状态定义。\n\n` +
      `## Accessibility（可访问性）\n\n` +
      `- TODO: 补充 ARIA、焦点顺序、读屏文案和对比度要求。\n`
    );
  }

  function buildDefaultStateMapContent(item) {
    return (
      `# State Map\n\n` +
      `- cacheKey: ${item.fileKey}#${item.nodeId || "__FILE__"}\n` +
      `- completeness: ${normalizeCompletenessList(item.completeness).join(", ") || "N/A"}\n\n` +
      `## Interactions\n\n` +
      `| Trigger | From | To | Notes |\n` +
      `| --- | --- | --- | --- |\n` +
      `| TODO | default | TODO | 补充点击/键盘/失焦行为 |\n\n` +
      `## States\n\n` +
      `| State | Visual | Data | Notes |\n` +
      `| --- | --- | --- | --- |\n` +
      `| default | TODO | TODO | 初始态 |\n` +
      `| hover | TODO | TODO | 悬停态 |\n` +
      `| active | TODO | TODO | 激活态 |\n` +
      `| focus | TODO | TODO | 焦点态 |\n` +
      `| disabled | TODO | TODO | 禁用态 |\n\n` +
      `## Accessibility\n\n` +
      `- TODO: 补充 role / aria-* / tab 顺序 / 键盘行为。\n`
    );
  }

  function buildDefaultRawContent(item) {
    const completeness = normalizeCompletenessList(item.completeness);
    return `${JSON.stringify(
      {
        source: item.source,
        fileKey: item.fileKey,
        nodeId: item.nodeId,
        scope: item.scope,
        syncedAt: item.syncedAt,
        completeness,
        coverageSummary: buildCoverageSummary(completeness),
        interactions: {
          notes: "TODO: 补充点击、键盘、失焦、外部点击等交互规则。",
        },
        states: {
          notes: "TODO: 补充状态矩阵（default/hover/active/focus/disabled）。",
        },
        accessibility: {
          notes: "TODO: 补充 ARIA、焦点管理、读屏文本、无障碍要求。",
        },
      },
      null,
      2
    )}\n`;
  }

  function ensureEntryFiles(item) {
    ensureFileWithDefault(
      item.paths.meta,
      `${JSON.stringify(
        {
          fileKey: item.fileKey,
          nodeId: item.nodeId,
          scope: item.scope,
          source: item.source,
          syncedAt: item.syncedAt,
          completeness: normalizeCompletenessList(item.completeness),
        },
        null,
        2
      )}\n`
    );
    ensureFileWithDefault(item.paths.spec, buildDefaultSpecContent(item));
    ensureFileWithDefault(item.paths.stateMap, buildDefaultStateMapContent(item));
    ensureFileWithDefault(item.paths.raw, buildDefaultRawContent(item));
    hydrateMcpEntryFilesIfNeeded(item);
  }

  function ensureEntryFilesAndHook(cacheKey, item) {
    ensureEntryFiles(item);
    runPostEnsureHook(cacheKey, item);
  }

  return {
    ensureEntryFilesAndHook,
  };
}

module.exports = {
  createEntryFilesService,
};