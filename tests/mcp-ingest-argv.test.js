#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  coalesceFigmaMcpIngestArgvSlice,
  figmaUrlBaseAllowsQueryTailCoalesce,
  isLikelyUrlQueryContinuation,
} = require("../scripts/workflow/mcp-ingest-argv.cjs");

assert.strictEqual(figmaUrlBaseAllowsQueryTailCoalesce("https://www.figma.com/design/a/b?node-id=1-2"), true);
assert.strictEqual(figmaUrlBaseAllowsQueryTailCoalesce("https://example.com/?node-id=1-2"), false);
assert.strictEqual(isLikelyUrlQueryContinuation("m=dev"), true);
assert.strictEqual(isLikelyUrlQueryContinuation("x"), false);

{
  const out = coalesceFigmaMcpIngestArgvSlice([
    "--quiet",
    "--url=https://www.figma.com/design/AbCdEfGh/x?node-id=1-2",
    "m=dev",
    "t=abc",
    "--enrich",
  ]);
  assert.deepStrictEqual(out, [
    "--quiet",
    "--url=https://www.figma.com/design/AbCdEfGh/x?node-id=1-2&m=dev&t=abc",
    "--enrich",
  ]);
}

{
  const out = coalesceFigmaMcpIngestArgvSlice([
    "--url",
    "https://www.figma.com/design/AbCdEfGh/x?node-id=9-8",
    "m=dev",
    "--stdin",
  ]);
  assert.deepStrictEqual(out, ["--url=https://www.figma.com/design/AbCdEfGh/x?node-id=9-8&m=dev", "--stdin"]);
}

{
  const out = coalesceFigmaMcpIngestArgvSlice(["--url=https://www.figma.com/design/AbCdEfGh/x?node-id=1-2", "positional"]);
  assert.deepStrictEqual(out, ["--url=https://www.figma.com/design/AbCdEfGh/x?node-id=1-2", "positional"]);
}

{
  const out = coalesceFigmaMcpIngestArgvSlice(["--quiet", "--", "--url=https://www.figma.com/design/a/x?node-id=1-2", "m=dev"]);
  assert.deepStrictEqual(out, ["--quiet", "--", "--url=https://www.figma.com/design/a/x?node-id=1-2", "m=dev"]);
}

console.log("mcp-ingest-argv.test: ok");
