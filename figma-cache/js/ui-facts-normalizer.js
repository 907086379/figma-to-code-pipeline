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

function dedupeStrings(values) {
  const seen = new Set();
  const output = [];
  values.forEach((input) => {
    const value = String(input || "").trim();
    if (!value) {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    output.push(value);
  });
  return output;
}

function dedupeTokens(tokens) {
  const seen = new Set();
  const output = [];
  tokens.forEach((token) => {
    const name = String(token.name || "").trim();
    const value = normalizeHexColor(String(token.value || ""));
    const key = `${name.toLowerCase()}@@${value}`;
    if (!name && !value) {
      return;
    }
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push({
      name,
      value,
      source: token.source || "unknown",
    });
  });
  return output;
}

function isPlaceholderText(input) {
  return /(TODO|待补充|待完善|待确认|占位|TBD|N\/A|none)/i.test(String(input || ""));
}

function extractSpecFacts(specText) {
  const textFacts = [];
  const tokenFacts = [];
  const tokenRegex = /-\s*([^:\n]+?)\s*:\s*(#[0-9a-fA-F]{3,8})/g;
  String(specText || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const t = line.trim();
      if (!t.startsWith("-")) {
        return;
      }
      let hasToken = false;
      let match = null;
      while ((match = tokenRegex.exec(t))) {
        hasToken = true;
        tokenFacts.push({
          name: String(match[1] || "").trim(),
          value: String(match[2] || "").trim(),
          source: "spec.md",
        });
      }
      if (!hasToken) {
        const text = t.replace(/^-+\s*/, "").trim();
        if (text) {
          textFacts.push(text);
        }
      }
    });
  return {
    textFacts: dedupeStrings(textFacts),
    tokenFacts: dedupeTokens(tokenFacts),
  };
}

function collectVariableTokens(value, prefix, out) {
  if (value == null) {
    return;
  }
  if (typeof value === "string") {
    const hex = normalizeHexColor(value);
    if (hex) {
      out.push({
        name: prefix,
        value: hex,
        source: "mcp-raw-get-variable-defs",
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectVariableTokens(entry, `${prefix}[${index}]`, out));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      collectVariableTokens(entry, next, out);
    });
  }
}

function extractStateFacts(stateMapText) {
  const states = new Set();
  const lines = String(stateMapText || "").split(/\r?\n/);
  let inStateSection = false;
  lines.forEach((line) => {
    const t = line.trim();
    if (/^##\s+/i.test(t)) {
      inStateSection = /(states?|state\s*map|状态)/i.test(t);
      return;
    }
    if (!inStateSection || !t.startsWith("|")) {
      return;
    }
    const cells = t
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!cells.length) {
      return;
    }
    const state = String(cells[0] || "").toLowerCase();
    if (!state || state === "state" || /^-+$/.test(state)) {
      return;
    }
    if (isPlaceholderText(state)) {
      return;
    }
    states.add(state);
  });
  return [...states];
}

function extractInteractionFacts(rawJson) {
  const interactionFacts = [];
  const notes = [];
  const interactions = rawJson && typeof rawJson.interactions === "object" ? rawJson.interactions : {};
  if (Array.isArray(interactions.events)) {
    interactions.events.forEach((evt) => interactionFacts.push(String(evt || "").trim()));
  }
  if (typeof interactions.notes === "string") {
    notes.push(interactions.notes);
  }
  const states = rawJson && typeof rawJson.states === "object" ? rawJson.states : {};
  if (typeof states.notes === "string") {
    notes.push(states.notes);
  }
  const accessibility = rawJson && typeof rawJson.accessibility === "object" ? rawJson.accessibility : {};
  if (typeof accessibility.notes === "string") {
    notes.push(accessibility.notes);
  }
  return {
    interactionFacts: dedupeStrings(interactionFacts),
    notes: dedupeStrings(notes),
  };
}

function normalizeUiFacts(input) {
  const payload = input && typeof input === "object" ? input : {};
  const specText = String(payload.specText || "");
  const stateMapText = String(payload.stateMapText || "");
  const rawJson = payload.rawJson && typeof payload.rawJson === "object" ? payload.rawJson : {};
  const variableDefs =
    payload.variableDefsJson && typeof payload.variableDefsJson === "object"
      ? payload.variableDefsJson
      : null;

  const specFacts = extractSpecFacts(specText);
  const stateFacts = extractStateFacts(stateMapText);
  const interactionFacts = extractInteractionFacts(rawJson);

  const variableTokens = [];
  if (variableDefs) {
    collectVariableTokens(variableDefs, "", variableTokens);
  }

  const tokenFacts = dedupeTokens([...specFacts.tokenFacts, ...variableTokens]);
  const placeholderSources = [
    specText,
    stateMapText,
    ...interactionFacts.notes,
    JSON.stringify(rawJson || {}),
  ];

  return {
    dimensions: {
      layoutReady: !!(payload.entryReady && payload.evidenceReady),
      textReady: specFacts.textFacts.length > 0,
      tokenReady: tokenFacts.length > 0,
      stateReady: stateFacts.length > 0,
      interactionReady: interactionFacts.interactionFacts.length > 0 || interactionFacts.notes.length > 0,
    },
    facts: {
      text: specFacts.textFacts,
      tokens: tokenFacts,
      states: stateFacts,
      interactions: interactionFacts.interactionFacts,
      notes: interactionFacts.notes,
    },
    hasPlaceholder: placeholderSources.some((source) => isPlaceholderText(source)),
  };
}

module.exports = {
  normalizeUiFacts,
  normalizeHexColor,
};
