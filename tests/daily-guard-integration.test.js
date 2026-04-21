#!/usr/bin/env node
"use strict";

/**
 * 金丝雀集成：固定 fixture + 子进程，覆盖团队日常易踩的两条门禁脚本，
 * 避免仅依赖全仓 smoke 时的大改静默回归。
 */

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const forbiddenScript = path.join(root, "scripts", "forbidden-markup-check.cjs");
const docEncodingScript = path.join(root, "scripts", "verify", "check-doc-encoding.js");
const fixtureDir = path.join(root, "tests", "fixtures", "daily-guard");
const cleanVue = path.join(fixtureDir, "clean.vue");
const badVue = path.join(fixtureDir, "forbidden-button.vue");
const cleanMd = path.join(fixtureDir, "utf8-clean.md");

function runNode(scriptPath, argv, cwd) {
  return execFileSync(process.execPath, [scriptPath, ...argv], {
    cwd: cwd || root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runNodeStatus(scriptPath, argv, cwd) {
  try {
    execFileSync(process.execPath, [scriptPath, ...argv], {
      cwd: cwd || root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (e) {
    const code = typeof e.status === "number" ? e.status : 1;
    return code;
  }
}

function main() {
  assert.ok(fs.existsSync(cleanVue), `missing fixture: ${cleanVue}`);
  assert.ok(fs.existsSync(badVue), `missing fixture: ${badVue}`);
  assert.ok(fs.existsSync(cleanMd), `missing fixture: ${cleanMd}`);

  const relClean = path.relative(root, cleanVue).split(path.sep).join("/");
  const relBad = path.relative(root, badVue).split(path.sep).join("/");

  const outOk = runNode(forbiddenScript, ["--file", relClean], root);
  assert.ok(
    String(outOk).includes("[forbidden-markup-check] ok"),
    "forbidden-markup-check should print ok"
  );

  const badStatus = runNodeStatus(forbiddenScript, ["--file", relBad], root);
  assert.strictEqual(badStatus, 2, "forbidden-markup-check should exit 2 on violations");

  const tmpGood = fs.mkdtempSync(path.join(os.tmpdir(), "fc-daily-doc-ok-"));
  fs.copyFileSync(cleanMd, path.join(tmpGood, "sample.md"));
  runNode(docEncodingScript, [], tmpGood);

  const tmpBad = fs.mkdtempSync(path.join(os.tmpdir(), "fc-daily-doc-bad-"));
  fs.writeFileSync(
    path.join(tmpBad, "mojibake.md"),
    "# trap\n\nThis line contains a known UTF-8/GBK mojibake signature: 闈㈠悜\n",
    "utf8"
  );
  const badDocStatus = runNodeStatus(docEncodingScript, [], tmpBad);
  assert.strictEqual(badDocStatus, 1, "check-doc-encoding should exit 1 when mojibake signature is present");

  console.log("daily-guard-integration.test: ok");
}

main();
