#!/usr/bin/env node
"use strict";

/**
 * Normalizes Figma MCP `get_design_context` payloads before persisting to mcp-raw.
 * Removes LLM instruction trailers and variable-font axis noise; keeps JSX/layout
 * used by toolchain heuristics (inset %, text snippets, data-node-id, assets).
 */

function sanitizeDesignContextTextForCache(input) {
  let text = String(input || "");
  // MCP appends an LLM prompt after the generated component (often glued as `}SUPER CRITICAL:...`).
  // Includes: conversion checklist, Tailwind disclaimer, token dump, component docs, image URL notes.
  text = text.replace(/\s*SUPER CRITICAL:[\s\S]*$/i, "");
  // React/TSX variable-font noise
  text = text.replace(/\sstyle=\{\{\s*fontVariationSettings\s*:\s*"[^"]*"\s*\}\}/g, "");
  text = text.replace(/\sstyle=\{\{\s*fontVariationSettings\s*:\s*'[^']*'\s*\}\}/g, "");
  // HTML / Vue: font-variation-settings / fontVariationSettings in style=""
  text = text.replace(/\sstyle="[^"]*(?:font-variation-settings|fontVariationSettings)[^"]*"/gi, "");
  return `${text.trimEnd()}\n`;
}

module.exports = { sanitizeDesignContextTextForCache };
