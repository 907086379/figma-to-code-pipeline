#!/usr/bin/env node
"use strict";

/**
 * Normalizes Figma MCP `get_design_context` payloads before persisting to mcp-raw.
 * Removes LLM instruction trailers and variable-font axis noise; keeps JSX/layout
 * used by toolchain heuristics (inset %, text snippets, data-node-id, data-annotations, assets).
 * Note: Figma/Dev Mode notes often appear as `data-annotations="…"` on the same tag as
 * `data-node-id` (inside the generated component, before the SUPER CRITICAL anchor) — those are kept.
 */

function sanitizeDesignContextTextForCache(input) {
  let text = String(input || "");
  // MCP appends an LLM prompt after the generated component (often glued as `}SUPER CRITICAL:...`).
  // Includes: conversion checklist, Tailwind disclaimer, token dump, component docs, image URL notes.
  // Optional Markdown emphasis; colon may vary slightly — strip everything from this anchor to EOF.
  text = text.replace(/\s*\*{0,2}\s*SUPER\s+CRITICAL\s*:\s*[\s\S]*$/i, "");
  // React/TSX variable-font noise
  text = text.replace(/\sstyle=\{\{\s*fontVariationSettings\s*:\s*"[^"]*"\s*\}\}/g, "");
  text = text.replace(/\sstyle=\{\{\s*fontVariationSettings\s*:\s*'[^']*'\s*\}\}/g, "");
  // HTML / Vue: font-variation-settings / fontVariationSettings in style=""
  text = text.replace(/\sstyle="[^"]*(?:font-variation-settings|fontVariationSettings)[^"]*"/gi, "");
  return `${text.trimEnd()}\n`;
}

module.exports = { sanitizeDesignContextTextForCache };
