/* eslint-disable no-console */

const { mergeLayoutMetricsFromGeometry, buildEvidenceSummary } = require("./raw-derivatives");
const { itemCacheKeyFromItem } = require("./related-cache-keys");

function createEntryFilesService(deps) {
  const {
    fs,
    path,
    resolveMaybeAbsolutePath,
    normalizeCompletenessList,
    completenessAllDimensions,
    runPostEnsureHook,
    getRelatedCacheKeys,
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

  function writeJson(absPath, value) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  function upsertJsonFile(absPath, buildDefault, mutate) {
    const current = safeReadJson(absPath);
    const next = current && typeof current === "object" ? current : buildDefault();
    const mutated = mutate(next) || next;
    writeJson(absPath, mutated);
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

  function parseInsetShorthand(input) {
    const text = String(input || "").trim();
    if (!text) return null;
    const normalized = text.replace(/^\[|\]$/g, "");
    const parts = normalized
      .split("_")
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (!parts.length) return null;
    const values = parts.map((p) => {
      const m = p.match(/^(-?\d+(?:\.\d+)?)%$/);
      return m ? Number(m[1]) : NaN;
    });
    if (values.some((n) => !Number.isFinite(n))) return null;
    if (values.length === 1) {
      return { top: values[0], right: values[0], bottom: values[0], left: values[0] };
    }
    if (values.length === 2) {
      return { top: values[0], right: values[1], bottom: values[0], left: values[1] };
    }
    if (values.length === 3) {
      return { top: values[0], right: values[1], bottom: values[2], left: values[1] };
    }
    return { top: values[0], right: values[1], bottom: values[2], left: values[3] };
  }

  function percentToPx(percent, boxPx) {
    return (Number(percent) / 100) * Number(boxPx);
  }

  function extractIconMetricsFromDesignContext(designContextText) {
    const text = String(designContextText || "");
    if (!text) return [];

    // Heuristic: icon outer container has size-[Npx] + data-node-id + data-name.
    // The immediate inner vector wrapper often uses absolute inset-[..%..] specifying padding.
    const outerRe =
      /<div[^>]*className="[^"]*?\bsize-\[(\d+)px\][^"]*?"[^>]*data-node-id="([^"]+)"[^>]*data-name="([^"]+)"[^>]*>/gi;
    const insetRe = /\babsolute\b[^"]*?\binset-\[([^\]]+)\]/i;

    const metrics = [];
    let outerMatch = null;
    while ((outerMatch = outerRe.exec(text))) {
      const box = Number(outerMatch[1]);
      const outerNodeId = String(outerMatch[2] || "").trim();
      const outerName = String(outerMatch[3] || "").trim();
      if (!Number.isFinite(box) || box <= 0) continue;
      const searchStart = outerRe.lastIndex;
      const window = text.slice(searchStart, Math.min(text.length, searchStart + 900));
      const insetMatch = window.match(insetRe);
      if (!insetMatch) continue;
      const insetRaw = `[${String(insetMatch[1] || "").trim()}]`;
      const parsed = parseInsetShorthand(insetRaw);
      if (!parsed) continue;

      const topPx = percentToPx(parsed.top, box);
      const rightPx = percentToPx(parsed.right, box);
      const bottomPx = percentToPx(parsed.bottom, box);
      const leftPx = percentToPx(parsed.left, box);
      const glyphW = box - leftPx - rightPx;
      const glyphH = box - topPx - bottomPx;

      metrics.push({
        nodeId: outerNodeId,
        name: outerName,
        boxPx: box,
        insetPercent: { ...parsed },
        insetPx: {
          top: Number(topPx.toFixed(4)),
          right: Number(rightPx.toFixed(4)),
          bottom: Number(bottomPx.toFixed(4)),
          left: Number(leftPx.toFixed(4)),
        },
        glyphPx: {
          width: Number(glyphW.toFixed(4)),
          height: Number(glyphH.toFixed(4)),
        },
        source: {
          kind: "design_context_inset_percent",
          insetRaw,
        },
      });
    }
    return metrics;
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
    const regex = /<(p|div|span)[^>]*>\s*([^<\n][^<]{0,120})\s*<\/(p|div|span)>/g;
    const output = [];
    let match = null;
    while ((match = regex.exec(text))) {
      const value = String(match[2] || "").replace(/\s+/g, " ").trim();
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

  /**
   * 基于 MCP 证据做 UI 交互模式的启发式归类，避免所有节点落同一套「下拉/设备」叙事。
   * 推断失败时回落到 generic，由人工补全。
   */
  function buildInteractionInferenceRecord(profile) {
    const p = profile && typeof profile === "object" ? profile : { kind: "generic", hints: {} };
    return {
      schemaVersion: 1,
      profile: p.kind,
      method: "design_context_metadata_heuristic_v1",
      signals: p.hints && typeof p.hints === "object" ? p.hints : {},
      disclaimer:
        "本条为工具链规则推断，不等价于设计交互原型或组件类型声明；Agent 与数据统计勿单独以此为结论，须核对 mcp-raw-get-design-context.txt 与设计稿。",
    };
  }

  function inferInteractionProfile(evidence) {
    const dc = String(evidence?.designContextText || "");
    const meta = String(evidence?.metadataText || "");
    const hay = `${dc}\n${meta}`;
    const low = hay.toLowerCase();

    let selectSignals = 0;
    if (/\b(select|listbox|combobox|dropdown)\b/i.test(dc)) selectSignals += 1;
    if (/chevron|caret-down|expand_more|arrow_drop_down/i.test(low)) selectSignals += 1;
    if (/data-name="[^"]*(select|dropdown|listbox)/i.test(dc)) selectSignals += 1;
    if (/\b(option|menuitem)\b/i.test(dc) && /list|menu|popover|dropdown/i.test(low)) selectSignals += 1;

    const inputFieldMarkers = (dc.match(/data-name="Input field"/gi) || []).length;
    const hasNativeInput = /<input\b/i.test(dc);
    const hasTextArea = /<textarea\b/i.test(dc);
    const inputLike =
      inputFieldMarkers > 0 ||
      hasNativeInput ||
      hasTextArea ||
      /type="(text|password|email|search|tel|url|number)"/i.test(dc);

    const hasButton =
      /data-name="Button"/i.test(dc) ||
      /<button\b/i.test(dc) ||
      /role="button"/i.test(dc);

    const hasPasswordAffordance =
      /data-name="[^"]*eye/i.test(dc) ||
      /eye-slash|visibility_off|password-toggle|show.*password/i.test(low);

    const strongSelect =
      selectSignals >= 2 || (selectSignals >= 1 && /chevron|arrow_drop|expand_more/i.test(low));

    if (strongSelect) {
      return {
        kind: "selectLike",
        hints: { selectSignals, inputFieldMarkers },
      };
    }

    if (inputLike && hasButton) {
      return {
        kind: "formInputs",
        hints: { inputFieldMarkers, hasPasswordAffordance },
      };
    }

    if (inputLike) {
      return {
        kind: "formInputs",
        hints: { inputFieldMarkers, hasPasswordAffordance },
      };
    }

    if (hasButton) {
      return {
        kind: "buttonPrimary",
        hints: {},
      };
    }

    return {
      kind: "generic",
      hints: {},
    };
  }

  function buildMcpHydratedSpecContent(item, evidence, profileMaybe) {
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

    const profile = profileMaybe || inferInteractionProfile(evidence);
    let interactionsLine;
    let statesLine;
    let a11yLine;
    if (profile.kind === "selectLike") {
      interactionsLine = `- get_design_context 启发式推断（非交互实证）：可能与「选择器 + 下拉/列表」类一致；展开、收起与选项选择须以稿与真实行为校验。`;
      statesLine = `- 推断状态草稿：default、expanded、selected（选项）、unselected（实现前请校对）。`;
      a11yLine = `- 若确为列表选择：可考虑 label + combobox/listbox；键盘可达与当前值读出以无障碍规范为准。`;
    } else if (profile.kind === "formInputs") {
      interactionsLine = `- get_design_context 启发式推断（非交互实证）：可能与「表单输入 + 主操作」一致；聚焦、输入、提交以产品与稿为准。`;
      statesLine = `- 推断状态草稿：default、focus、filled；错误态与禁用态以稿为准。`;
      a11yLine = `- 建议：label 与控件关联、错误提示可达、合理 Tab 顺序与焦点可见性。`;
    } else if (profile.kind === "buttonPrimary") {
      interactionsLine = `- get_design_context 启发式推断（非交互实证）：可能与「以按钮为主」的点击交互一致；请以稿校验。`;
      statesLine = `- 推断状态草稿：default、hover、active、disabled（以稿为准）。`;
      a11yLine = `- 建议：按钮具备可读名称；禁用态对辅助技术可用 aria-disabled。`;
    } else {
      interactionsLine = `- get_design_context 未能自动归类交互模式；以下章节请勿当作交付事实，请对照稿补充。`;
      statesLine = `- 状态矩阵请以设计稿与产品说明为准。`;
      a11yLine = `- 请依据实际组件类型补充无障碍约束。`;
    }

    return (
      `# Figma Spec\n\n` +
      `- fileKey: ${item.fileKey}\n` +
      `- scope: ${item.scope}\n` +
      `- nodeId: ${item.nodeId || "N/A"}\n` +
      `- source: ${item.source}\n` +
      `- syncedAt: ${item.syncedAt}\n` +
      `- completeness: ${completeness.join(", ") || "N/A"}\n` +
      `- interactionProfile: ${profile.kind}（启发式）\n` +
      `- interactionInferenceDisclaimer: 下文 Interactions/States 为自动化草稿，非设计结论；交互实证以 mcp-raw-get-design-context.txt 为准；详见 raw.json.interactionInference。\n\n` +
      `## Layout（结构）\n\n` +
      `- node: ${layout.name} (${layout.id})\n` +
      `- position: ${layout.pos}\n` +
      `- size: ${layout.size}\n\n` +
      `## Text（文案）\n\n` +
      `${textSection}\n\n` +
      `## Tokens（变量 / 样式）\n\n` +
      `${tokenSection}\n\n` +
      `## Interactions（交互）\n\n` +
      `${interactionsLine}\n\n` +
      `## States（状态）\n\n` +
      `${statesLine}\n\n` +
      `## Accessibility（可访问性）\n\n` +
      `${a11yLine}\n`
    );
  }

  function buildMcpHydratedStateMapContent(item, evidence, profileMaybe) {
    const layout = extractLayoutSummary(evidence.metadataText, item.nodeId || "N/A");
    const profile = profileMaybe || inferInteractionProfile(evidence);
    const completeness = normalizeCompletenessList(item.completeness).join(", ") || "N/A";

    const header =
      `# State Map\n\n` +
      `- cacheKey: ${item.fileKey}#${item.nodeId || "__FILE__"}\n` +
      `- completeness: ${completeness}\n` +
      `- interactionProfile: ${profile.kind}（启发式推断，来源：get_design_context / get_metadata；若与稿不符请修订）\n` +
      `- nodeName: ${layout.name}\n` +
      `- disclaimer: 下表为推断草稿，非统计意义上的「设计状态全集」；跨节点汇总前请读 raw.json.interactionInference 或人工校对。\n\n`;

    if (profile.kind === "selectLike") {
      return (
        header +
        `## Interactions\n\n` +
        `| Trigger | From | To | Notes |\n` +
        `| --- | --- | --- | --- |\n` +
        `| click selector | default | expanded | 展开选项列表 |\n` +
        `| click option | expanded | selected | 切换当前选项并关闭列表 |\n` +
        `| outside click / esc | expanded | default | 收起列表 |\n\n` +
        `## States\n\n` +
        `| State | Visual | Data | Notes |\n` +
        `| --- | --- | --- | --- |\n` +
        `| default | 选择器展示当前值 | currentValue=lastSelected | 初始态 |\n` +
        `| expanded | 展示下拉或浮层面板 | listOpen=true | 可选 list |\n` +
        `| selected | 当前项强调（勾选/高亮） | selectedId=optionId | 当前项 |\n` +
        `| unselected | 非当前项样式 | selectedId!=optionId | 其他项 |\n\n` +
        `## Accessibility\n\n` +
        `- role 建议：combobox + listbox + option；支持 Tab/Enter/Escape/Arrow 键导航。\n`
      );
    }

    if (profile.kind === "formInputs") {
      const pwd = !!(profile.hints && profile.hints.hasPasswordAffordance);
      const visibilityRow = pwd
        ? `| click visibility control | passwordHidden | passwordShown | 切换密码明文/遮蔽（稿中含显隐控件时） |\n`
        : "";
      const pwdStateRows = pwd
        ? `| passwordShown | 明文展示密码 | reveal=true | 显隐开启 |\n` +
          `| passwordHidden | 遮蔽展示密码 | reveal=false | 默认 |\n`
        : "";

      return (
        header +
        `## Interactions\n\n` +
        `| Trigger | From | To | Notes |\n` +
        `| --- | --- | --- | --- |\n` +
        `| focus field | default | focus | 文本输入获得焦点 |\n` +
        `| input | focus | filled | 输入内容更新 |\n` +
        `| blur | focus | default | 失焦恢复常态样式 |\n` +
        visibilityRow +
        `| primary action | filled | default | 主按钮或下一步（依产品流程） |\n\n` +
        `## States\n\n` +
        `| State | Visual | Data | Notes |\n` +
        `| --- | --- | --- | --- |\n` +
        `| default | 占位符或空值 | value="" | 初始 |\n` +
        `| focus | 焦点环或边框强调 | focusedField=id | 键盘可达 |\n` +
        `| filled | 用户输入后的展示 | value.length>0 | 可触发校验 |\n` +
        pwdStateRows +
        `| disabled | 控件禁用样式 | disabled=true | 若稿中存在 |\n\n` +
        `## Accessibility\n\n` +
        `- 建议：label 与控件关联；错误提示可读；密码字段策略按稿与产品规范。\n`
      );
    }

    if (profile.kind === "buttonPrimary") {
      return (
        header +
        `## Interactions\n\n` +
        `| Trigger | From | To | Notes |\n` +
        `| --- | --- | --- | --- |\n` +
        `| pointer down | default | active | 按下 |\n` +
        `| pointer up | active | default | 松开 |\n` +
        `| click | default | — | 触发主操作 |\n\n` +
        `## States\n\n` +
        `| State | Visual | Data | Notes |\n` +
        `| --- | --- | --- | --- |\n` +
        `| default | 常态 | idle | 初始 |\n` +
        `| hover | 悬停强调 | hover=true | 若稿含 |\n` +
        `| active | 按下态 | pressed=true | 瞬态 |\n` +
        `| disabled | 禁用样式 | disabled=true | 若稿含 |\n\n` +
        `## Accessibility\n\n` +
        `- 建议：具备可读名称；禁用态对辅助技术暴露 disabled 语义。\n`
      );
    }

    return (
      header +
      `## Interactions\n\n` +
      `| Trigger | From | To | Notes |\n` +
      `| --- | --- | --- | --- |\n` +
      `| （未自动识别固定模式） | default | default | 请对照设计稿补充触发器与状态流转 |\n\n` +
      `## States\n\n` +
      `| State | Visual | Data | Notes |\n` +
      `| --- | --- | --- | --- |\n` +
      `| default | 稿面初始呈现 | — | 作为还原基线 |\n\n` +
      `## Accessibility\n\n` +
      `- 请依据组件类型补充 role、键盘操作与读屏文案。\n`
    );
  }

  function hydrateRawTodoNotesIfNeeded(item, evidence, profileMaybe) {
    const rawAbs = resolveMaybeAbsolutePath(item.paths.raw);
    const raw = safeReadJson(rawAbs);
    if (!raw || typeof raw !== "object") {
      return;
    }
    let changed = false;
    const designHint = evidence && evidence.designContextText ? "（来源：get_design_context）" : "";
    const profile =
      profileMaybe ||
      (evidence && typeof evidence === "object"
        ? inferInteractionProfile(evidence)
        : { kind: "generic", hints: {} });

    if (raw.interactions && isPlaceholderText(raw.interactions.notes)) {
      if (profile.kind === "selectLike") {
        raw.interactions.notes =
          `【推断草稿】若为列表类选择器，常见须覆盖展开、选择、收起；若稿面不符请改写本条${designHint}。`;
      } else if (profile.kind === "formInputs") {
        raw.interactions.notes =
          `【推断草稿】若为表单区，常见涉及聚焦、输入、失焦与主操作；若稿面不符请改写本条${designHint}。`;
      } else if (profile.kind === "buttonPrimary") {
        raw.interactions.notes =
          `【推断草稿】若以按钮为主，常见涉及点击、悬停、按下与禁用；若稿面不符请改写本条${designHint}。`;
      } else {
        raw.interactions.notes = `请对照设计稿补充交互规则${designHint}。`;
      }
      changed = true;
    }
    if (raw.states && isPlaceholderText(raw.states.notes)) {
      if (profile.kind === "selectLike") {
        raw.states.notes =
          `【推断草稿】列表类常见状态包含 default/expanded/selected/unselected；请以稿与交互说明为准。`;
      } else if (profile.kind === "formInputs") {
        raw.states.notes =
          `【推断草稿】表单常见涉及 default/focus/filled 与错误/禁用；请以稿为准。`;
      } else if (profile.kind === "buttonPrimary") {
        raw.states.notes =
          `【推断草稿】按钮常见涉及 default/hover/active/disabled；请以稿面为准。`;
      } else {
        raw.states.notes = `请对照设计稿补充状态矩阵。`;
      }
      changed = true;
    }
    if (raw.accessibility && isPlaceholderText(raw.accessibility.notes)) {
      if (profile.kind === "selectLike") {
        raw.accessibility.notes =
          `建议采用 combobox/listbox 语义，提供键盘导航和读屏可感知的当前值。`;
      } else if (profile.kind === "formInputs") {
        raw.accessibility.notes =
          `建议为表单控件补充 label 关联、错误提示可读性与键盘遍历顺序。`;
      } else if (profile.kind === "buttonPrimary") {
        raw.accessibility.notes =
          `建议按钮具备清晰 accessible name，并保证焦点可见性。`;
      } else {
        raw.accessibility.notes = `请依据组件类型补充无障碍要求。`;
      }
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
    const profile = inferInteractionProfile(evidence);
    // Always refresh mcp-hydrated entry files to avoid stale evidence summaries
    // when completeness changes or when earlier runs wrote placeholder content.
    fs.writeFileSync(specAbs, buildMcpHydratedSpecContent(item, evidence, profile), "utf8");
    fs.writeFileSync(stateMapAbs, buildMcpHydratedStateMapContent(item, evidence, profile), "utf8");
    hydrateRawTodoNotesIfNeeded(item, evidence, profile);

    // Persist machine-friendly icon metrics for 1:1 icon glyph sizing,
    // optional layoutMetrics from mcp-raw/figma-geometry-metrics.json (Figma Plugin API / bounding boxes),
    // and evidenceSummary (observability only; not used for validate gates).
    try {
      const iconMetrics = extractIconMetricsFromDesignContext(evidence.designContextText);
      const rawAbs = resolveMaybeAbsolutePath(item.paths.raw);
      const nodeDir = findNodeDirByItem(item);
      const geometryAbs = nodeDir
        ? path.join(nodeDir, "mcp-raw", "figma-geometry-metrics.json")
        : "";
      const geometry = geometryAbs ? safeReadJson(geometryAbs) : null;
      const geometryFilePresent = !!(geometryAbs && fs.existsSync(geometryAbs));
      upsertJsonFile(
        rawAbs,
        () => JSON.parse(buildDefaultRawContent(item)),
        (next) => {
          next.interactionInference = buildInteractionInferenceRecord(profile);
          next.iconMetrics = iconMetrics;
          mergeLayoutMetricsFromGeometry(next, geometry);
          const iconN = Array.isArray(next.iconMetrics) ? next.iconMetrics.length : 0;
          const layoutN = Array.isArray(next.layoutMetrics) ? next.layoutMetrics.length : 0;
          next.evidenceSummary = buildEvidenceSummary({
            designContextText: evidence.designContextText,
            metadataText: evidence.metadataText,
            variableDefs: evidence.variableDefs,
            nodeId: item.nodeId || "",
            geometryFilePresent,
            iconMetricsCount: iconN,
            layoutMetricsCount: layoutN,
          });
          let relatedCacheKeys = [];
          if (typeof getRelatedCacheKeys === "function") {
            try {
              relatedCacheKeys = getRelatedCacheKeys(itemCacheKeyFromItem(item)) || [];
            } catch {
              relatedCacheKeys = [];
            }
          }
          if (Array.isArray(relatedCacheKeys) && relatedCacheKeys.length) {
            next.relatedCacheKeys = relatedCacheKeys;
          } else {
            delete next.relatedCacheKeys;
          }
          return next;
        }
      );
    } catch {}
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
        flow: covered.includes("flow") ? ["spec.md#flow"] : [],
        assets: covered.includes("assets") ? ["mcp-raw/get_design_context#assets"] : [],
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
    const metaAbs = resolveMaybeAbsolutePath(item.paths.meta);
    const rawAbs = resolveMaybeAbsolutePath(item.paths.raw);
    const completeness = normalizeCompletenessList(item.completeness);

    // Always keep meta/raw in sync with latest ensure/upsert, even if files already exist.
    upsertJsonFile(
      metaAbs,
      () => ({
        fileKey: item.fileKey,
        nodeId: item.nodeId,
        scope: item.scope,
        source: item.source,
        syncedAt: item.syncedAt,
        completeness,
      }),
      (next) => {
        next.fileKey = item.fileKey;
        next.nodeId = item.nodeId;
        next.scope = item.scope;
        next.source = item.source;
        next.syncedAt = item.syncedAt;
        next.completeness = completeness;
        return next;
      }
    );

    ensureFileWithDefault(item.paths.spec, buildDefaultSpecContent(item));
    ensureFileWithDefault(item.paths.stateMap, buildDefaultStateMapContent(item));
    if (!fs.existsSync(rawAbs)) {
      ensureFileWithDefault(item.paths.raw, buildDefaultRawContent(item));
    }
    upsertJsonFile(
      rawAbs,
      () => JSON.parse(buildDefaultRawContent(item)),
      (next) => {
        next.source = item.source;
        next.fileKey = item.fileKey;
        next.nodeId = item.nodeId;
        next.scope = item.scope;
        next.syncedAt = item.syncedAt;
        next.completeness = completeness;
        next.coverageSummary = buildCoverageSummary(completeness);
        return next;
      }
    );
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