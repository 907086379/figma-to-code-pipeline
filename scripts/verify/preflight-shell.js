#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
const modeArg = args.find((x) => x === "--strict" || x === "--warn") || "--warn";
const mode = modeArg === "--strict" ? "strict" : "warn";

const scriptPath = path.join(__dirname, "..", "preflight.ps1");

function runShell(exe, extraArgs) {
  const result = spawnSync(exe, extraArgs, {
    stdio: "inherit",
    shell: false,
  });
  return result;
}

function available(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore", shell: false });
  return result.status === 0;
}

const usePwsh = available("pwsh");

if (usePwsh) {
  const pwshArgs = [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Mode",
    mode,
  ];
  const r = runShell("pwsh", pwshArgs);
  process.exit(typeof r.status === "number" ? r.status : 1);
}

console.warn("[preflight] pwsh not found; fallback to Windows PowerShell.");
const psArgs = [
  "-NoLogo",
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  scriptPath,
  "-Mode",
  mode,
];
const r = runShell("powershell", psArgs);
process.exit(typeof r.status === "number" ? r.status : 1);
