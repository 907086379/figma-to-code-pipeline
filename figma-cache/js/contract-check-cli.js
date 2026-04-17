/* eslint-disable no-console */
"use strict";

function normalizeHexColor(value) {
  if (typeof value !== "string") {
    return "";
  }
  const raw = value.trim();
  const match = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!match) {
    return "";
  }
  const body = match[1].toUpperCase();
  if (body.length === 3) {
    return `#${body
      .split("")
      .map((ch) => `${ch}${ch}`)
      .join("")}`;
  }
  return `#${body}`;
}

function extractTokenFactsFromSpec(specText) {
  const output = [];
  const regex = /-\s*([^:\n]+?)\s*:\s*(#[0-9a-fA-F]{3,8})/g;
  let match = null;
  while ((match = regex.exec(specText))) {
    const tokenName = String(match[1] || "").trim();
    const tokenValue = normalizeHexColor(String(match[2] || ""));
    if (!tokenName && !tokenValue) {
      continue;
    }
    output.push({
      tokenName,
      tokenValue,
      source: "spec.md",
    });
  }
  return output;
}

function collectTokenFactsFromVariableDefs(value, pathPrefix, output) {
  if (value == null) {
    return;
  }

  if (typeof value === "string") {
    const hex = normalizeHexColor(value);
    if (hex) {
      output.push({
        tokenName: pathPrefix,
        tokenValue: hex,
        source: "mcp-raw-get-variable-defs",
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const nextPrefix = pathPrefix ? `${pathPrefix}[${index}]` : `[${index}]`;
      collectTokenFactsFromVariableDefs(entry, nextPrefix, output);
    });
    return;
  }

  if (typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => {
      const nextPrefix = pathPrefix ? `${pathPrefix}.${key}` : key;
      collectTokenFactsFromVariableDefs(entry, nextPrefix, output);
    });
  }
}

function isPlaceholderCell(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value || /^-+$/.test(value)) {
    return true;
  }
  return /^(todo|tbd|n\/?a|none|\(none\)|待补充|待完善|待确认|占位|补充)/i.test(value);
}

function extractStatesFromStateMap(stateMapText) {
  const states = new Set();
  const lines = stateMapText.split(/\r?\n/);
  let inStatesSection = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (/^##\s+States\b/i.test(trimmed)) {
      inStatesSection = true;
      return;
    }
    if (/^##\s+/i.test(trimmed) && !/^##\s+States\b/i.test(trimmed)) {
      inStatesSection = false;
      return;
    }
    if (!inStatesSection || !trimmed.startsWith("|")) {
      return;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!cells.length) {
      return;
    }

    const first = String(cells[0] || "").trim().toLowerCase();
    if (!first || first === "state" || /^-+$/.test(first)) {
      return;
    }

    // Ignore scaffold rows where visual/data columns are still placeholders.
    const visualCell = cells.length > 1 ? cells[1] : "";
    const dataCell = cells.length > 2 ? cells[2] : "";
    if (isPlaceholderCell(visualCell) && isPlaceholderCell(dataCell)) {
      return;
    }

    states.add(first);
  });

  return [...states];
}
function dedupeTokenFacts(facts) {
  const seen = new Set();
  const output = [];
  facts.forEach((fact) => {
    const name = String(fact.tokenName || "").trim().toLowerCase();
    const value = normalizeHexColor(String(fact.tokenValue || ""));
    const key = `${name}@@${value}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push({
      tokenName: fact.tokenName,
      tokenValue: value,
      source: fact.source,
    });
  });
  return output;
}

function mergeContractWithOverride(contract, override, hardErrors, cacheKey) {
  const base = contract && typeof contract === "object" ? contract : {};
  const nodeOverride = override && typeof override === "object" ? override : {};
  const merged = {
    ...base,
    tokenMappings: [...(Array.isArray(base.tokenMappings) ? base.tokenMappings : [])],
    stateMappings: {
      ...(base.stateMappings && typeof base.stateMappings === "object" ? base.stateMappings : {}),
    },
    layoutRules: [...(Array.isArray(base.layoutRules) ? base.layoutRules : [])],
    typographyRules: [...(Array.isArray(base.typographyRules) ? base.typographyRules : [])],
    interactionRules: [...(Array.isArray(base.interactionRules) ? base.interactionRules : [])],
  };

  if (!nodeOverride || Object.keys(nodeOverride).length === 0) {
    return merged;
  }

  const overrideTokenMappings = Array.isArray(nodeOverride.tokenMappings)
    ? nodeOverride.tokenMappings
    : [];
  overrideTokenMappings.forEach((overrideMapping) => {
    const tokenName = String(overrideMapping.figmaToken || "")
      .trim()
      .toLowerCase();
    const global = merged.tokenMappings.find(
      (entry) => String(entry.figmaToken || "").trim().toLowerCase() === tokenName
    );
    if (
      global &&
      global.projectBinding &&
      overrideMapping.projectBinding &&
      String(global.projectBinding.value || "") !== String(overrideMapping.projectBinding.value || "")
    ) {
      hardErrors.push(
        `node override conflict: ${cacheKey} token '${overrideMapping.figmaToken}' projectBinding differs from global contract`
      );
    }
  });
  merged.tokenMappings.push(...overrideTokenMappings);

  const overrideStateMappings =
    nodeOverride.stateMappings && typeof nodeOverride.stateMappings === "object"
      ? nodeOverride.stateMappings
      : {};
  Object.entries(overrideStateMappings).forEach(([key, value]) => {
    const global = merged.stateMappings[key];
    if (global && Array.isArray(global.requiredStates) && value && Array.isArray(value.requiredStates)) {
      const missing = global.requiredStates.filter(
        (state) =>
          !value.requiredStates.map((v) => String(v || "").toLowerCase()).includes(String(state || "").toLowerCase())
      );
      if (missing.length) {
        hardErrors.push(
          `node override conflict: ${cacheKey} stateMappings.${key} misses global requiredStates: ${missing.join(", ")}`
        );
      }
    }
    merged.stateMappings[key] = value;
  });

  if (Array.isArray(nodeOverride.layoutRules)) {
    merged.layoutRules.push(...nodeOverride.layoutRules);
  }
  if (Array.isArray(nodeOverride.typographyRules)) {
    merged.typographyRules.push(...nodeOverride.typographyRules);
  }
  if (Array.isArray(nodeOverride.interactionRules)) {
    merged.interactionRules.push(...nodeOverride.interactionRules);
  }

  return merged;
}

function evaluateRuleSet(ruleSet, sourceText, cacheKey, hardErrors, warnings) {
  if (!Array.isArray(ruleSet)) {
    return;
  }
  ruleSet.forEach((rule, indexNo) => {
    if (!rule || typeof rule !== "object") {
      hardErrors.push(`rule[${indexNo}] is not object`);
      return;
    }
    const pattern = String(rule.pattern || "").trim();
    const ruleId = String(rule.id || `rule-${indexNo}`);
    const required = rule.required !== false;
    if (!pattern) {
      hardErrors.push(`${ruleId}: pattern missing`);
      return;
    }
    let matched = false;
    try {
      matched = new RegExp(pattern, "i").test(sourceText);
    } catch {
      hardErrors.push(`${ruleId}: invalid regex pattern '${pattern}'`);
      return;
    }
    if (!matched && required) {
      hardErrors.push(`${cacheKey}: missing required rule '${ruleId}'`);
      return;
    }
    if (!matched && !required) {
      warnings.push(`${cacheKey}: optional rule not matched '${ruleId}'`);
    }
  });
}

function buildContractCheckReport(options, deps) {
  const {
    cacheKey = "",
    warnUnmappedTokens = false,
    warnUnmappedStates = false,
  } = options || {};

  const {
    index,
    contract,
    readTextOrEmpty,
    readJsonOrNull,
    resolveMaybeAbsolutePath,
    normalizeSlash,
  } = deps;

  const hardErrors = [];
  const warnings = [];

  if (!index || typeof index !== "object") {
    return {
      ok: false,
      hardErrors: ["index not found or invalid JSON"],
      warnings: [],
      checkedItems: 0,
      checkedCacheKeys: [],
    };
  }

  if (!contract || typeof contract !== "object") {
    return {
      ok: false,
      hardErrors: ["adapter contract not found or invalid JSON"],
      warnings: [],
      checkedItems: 0,
      checkedCacheKeys: [],
    };
  }

  const items = index.items && typeof index.items === "object" ? index.items : {};
  const keys = Object.keys(items);
  const targetKeys = cacheKey
    ? keys.filter((key) => key === cacheKey)
    : keys;

  if (cacheKey && !targetKeys.length) {
    hardErrors.push(`cacheKey not found: ${cacheKey}`);
  }

  const missingTokenMappings = [];
  const missingStateMappings = [];

  targetKeys.forEach((key) => {
    const item = items[key];
    const completeness = Array.isArray(item.completeness) ? item.completeness : [];

    if (!item || !item.paths || !item.paths.meta) {
      return;
    }

    const metaAbs = resolveMaybeAbsolutePath(item.paths.meta);
    const nodeDir = require("path").dirname(metaAbs);

    const specText = item.paths && item.paths.spec
      ? readTextOrEmpty(resolveMaybeAbsolutePath(item.paths.spec))
      : "";
    const stateMapText = item.paths && item.paths.stateMap
      ? readTextOrEmpty(resolveMaybeAbsolutePath(item.paths.stateMap))
      : "";
    const rawText = item.paths && item.paths.raw
      ? readTextOrEmpty(resolveMaybeAbsolutePath(item.paths.raw))
      : "";
    const overridePath = require("path").join(nodeDir, "ui-override.json");
    const nodeOverride = readJsonOrNull(overridePath);
    const targetContract = mergeContractWithOverride(contract, nodeOverride, hardErrors, key);
    const tokenMappings = Array.isArray(targetContract.tokenMappings)
      ? targetContract.tokenMappings
      : [];
    const stateMappings =
      targetContract.stateMappings && typeof targetContract.stateMappings === "object"
        ? targetContract.stateMappings
        : {};

    const mappedTokenNames = new Set();
    const mappedTokenValues = new Set();
    const mappedStates = new Set();
    tokenMappings.forEach((mapping, indexNo) => {
      if (!mapping || typeof mapping !== "object") {
        hardErrors.push(`tokenMappings[${indexNo}] is not an object`);
        return;
      }
      const tokenName = String(mapping.figmaToken || "").trim().toLowerCase();
      const tokenValue = normalizeHexColor(String(mapping.figmaValue || ""));
      if (tokenName) {
        mappedTokenNames.add(tokenName);
      }
      if (tokenValue) {
        mappedTokenValues.add(tokenValue);
      }
      if (mapping.required === true) {
        const binding = mapping.projectBinding;
        if (!binding || typeof binding !== "object") {
          hardErrors.push(`required mapping '${mapping.id || indexNo}' missing projectBinding`);
        }
      }
    });
    Object.values(stateMappings).forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const requiredStates = Array.isArray(entry.requiredStates) ? entry.requiredStates : [];
      requiredStates.forEach((state) => {
        const normalized = String(state || "").trim().toLowerCase();
        if (normalized) {
          mappedStates.add(normalized);
        }
      });
    });
    if (!tokenMappings.length) {
      hardErrors.push("tokenMappings is empty");
    }
    if (!Object.keys(stateMappings).length) {
      hardErrors.push("stateMappings is empty");
    }

    const manifestPath = require("path").join(nodeDir, "mcp-raw", "mcp-raw-manifest.json");
    const manifest = readJsonOrNull(manifestPath);
    let variableFacts = [];
    if (
      manifest &&
      manifest.files &&
      typeof manifest.files === "object" &&
      manifest.files.get_variable_defs
    ) {
      const variableDefsPath = require("path").join(
        nodeDir,
        "mcp-raw",
        String(manifest.files.get_variable_defs)
      );
      const variableDefs = readJsonOrNull(variableDefsPath);
      if (variableDefs && typeof variableDefs === "object") {
        const output = [];
        collectTokenFactsFromVariableDefs(variableDefs, "", output);
        variableFacts = output;
      }
    }

    const tokenFacts = dedupeTokenFacts([
      ...extractTokenFactsFromSpec(specText),
      ...variableFacts,
    ]);

    if (completeness.includes("tokens") || tokenFacts.length) {
      tokenFacts.forEach((fact) => {
        const name = String(fact.tokenName || "").trim().toLowerCase();
        const value = normalizeHexColor(String(fact.tokenValue || ""));
        const matchedByName = name && mappedTokenNames.has(name);
        const matchedByValue = value && mappedTokenValues.has(value);

        if (!matchedByName && !matchedByValue) {
          missingTokenMappings.push(
            `token unmapped: ${key} :: ${fact.tokenName || "(empty)"} :: ${
              value || "(none)"
            } (${fact.source})`
          );
        }
      });
    }

    if (completeness.includes("states") || stateMapText) {
      const states = extractStatesFromStateMap(stateMapText);
      states.forEach((state) => {
        if (!mappedStates.has(state)) {
          missingStateMappings.push(`state unmapped: ${key} :: ${state} (state-map.md)`);
        }
      });
    }

    const ruleSource = `${specText}\n${stateMapText}\n${rawText}`;
    evaluateRuleSet(targetContract.layoutRules, ruleSource, key, hardErrors, warnings);
    evaluateRuleSet(targetContract.typographyRules, ruleSource, key, hardErrors, warnings);
    evaluateRuleSet(targetContract.interactionRules, ruleSource, key, hardErrors, warnings);
  });

  if (missingTokenMappings.length) {
    if (warnUnmappedTokens) {
      warnings.push(...missingTokenMappings);
    } else {
      hardErrors.push(...missingTokenMappings);
    }
  }

  if (missingStateMappings.length) {
    if (warnUnmappedStates) {
      warnings.push(...missingStateMappings);
    } else {
      hardErrors.push(...missingStateMappings);
    }
  }

  return {
    ok: hardErrors.length === 0,
    hardErrors,
    warnings,
    checkedItems: targetKeys.length,
    checkedCacheKeys: targetKeys,
    contract: normalizeSlash(String(options.contractPath || "")),
  };
}

module.exports = {
  buildContractCheckReport,
};