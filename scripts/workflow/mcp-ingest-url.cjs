#!/usr/bin/env node
"use strict";

/**
 * npm/pnpm-safe wrapper: strips stray `--` and forwards to mcp-raw-ingest.cjs.
 * Usage: node scripts/workflow/mcp-ingest-url.cjs --quiet -- "https://www.figma.com/..."
 *   or: pnpm run fc:mcp:ingest:url -- "https://..."
 */

const path = require("path");
const { spawnSync } = require("child_process");
const { coalesceFigmaMcpIngestArgvSlice } = require("./mcp-ingest-argv.cjs");

const ingest = path.join(__dirname, "mcp-raw-ingest.cjs");
const raw = process.argv.slice(2).filter((a) => a !== "--");
const coalesced = coalesceFigmaMcpIngestArgvSlice(raw);

const r = spawnSync(process.execPath, [ingest, ...coalesced], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

process.exit(r.status ?? 1);
