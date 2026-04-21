#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET_EXTENSIONS = new Set([".md", ".mdc"]);
const IGNORE_DIRS = new Set([".git", "node_modules"]);

// Common mojibake fragments from UTF-8 text decoded as GBK/CP936 then re-saved.
const MOJIBAKE_FRAGMENTS = [
  "闈㈠悜",
  "鍥㈤槦",
  "鎻愮ず璇",
  "鏂囨。",
  "缂撳瓨",
  "浠撳簱",
];

function stripUtf8Bom(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.slice(3);
  }
  return buffer;
}

function collectTargetFiles(dir, result) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      collectTargetFiles(absPath, result);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (TARGET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      result.push(absPath);
    }
  }
}

function relative(p) {
  return p.split(path.sep).join("/").replace(`${ROOT.replace(/\\/g, "/")}/`, "");
}

function detectMojibake(text) {
  return MOJIBAKE_FRAGMENTS.find((fragment) => text.includes(fragment)) || "";
}

function main() {
  const files = [];
  collectTargetFiles(ROOT, files);

  const utf8DecodeErrors = [];
  const mojibakeFiles = [];

  for (const file of files) {
    try {
      const buf = stripUtf8Bom(fs.readFileSync(file));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      const matched = detectMojibake(text);
      if (matched) {
        mojibakeFiles.push({ file, matched });
      }
    } catch (error) {
      utf8DecodeErrors.push({ file, error: error.message });
    }
  }

  if (utf8DecodeErrors.length || mojibakeFiles.length) {
    console.error("[verify:docs] FAILED");

    if (utf8DecodeErrors.length) {
      console.error("\nUTF-8 decode errors:");
      for (const item of utf8DecodeErrors) {
        console.error(`- ${relative(item.file)} :: ${item.error}`);
      }
    }

    if (mojibakeFiles.length) {
      console.error("\nPossible mojibake detected:");
      for (const item of mojibakeFiles) {
        console.error(`- ${relative(item.file)} :: contains '${item.matched}'`);
      }
    }

    process.exit(1);
  }

  console.log(`[verify:docs] OK (${files.length} files)`);
}

main();
