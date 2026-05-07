#!/usr/bin/env node
"use strict";

/**
 * fc:mcp:ingest 失败时写入固定路径的结构化报告，供主会话只读路径而不贴长日志。
 */

const fs = require("fs");
const path = require("path");

/**
 * @param {{
 *   cacheDirAbs: string,
 *   cacheKeyStr: string,
 *   stage: string,
 *   exitCode: number,
 *   commandLine: string,
 *   stdout?: string,
 *   stderr?: string,
 *   cwdForRelative?: string,
 *   failureKind?: "gate" | "preflight",
 * }} opts
 */
function writeMcpIngestFailureArtifact({
  cacheDirAbs,
  cacheKeyStr,
  stage,
  exitCode,
  commandLine,
  stdout,
  stderr,
  cwdForRelative = process.cwd(),
  failureKind = "gate",
}) {
  const reportsDir = path.join(cacheDirAbs, "reports", "runtime");
  fs.mkdirSync(reportsDir, { recursive: true });

  const logPath = path.join(reportsDir, "mcp-ingest-last.log");
  const jsonPath = path.join(reportsDir, "mcp-ingest-failure.json");
  const ts = new Date().toISOString();

  const logBody = [
    `[${ts}] failureKind=${failureKind} stage=${stage} exit=${exitCode} cacheKey=${cacheKeyStr}`,
    `command: ${commandLine}`,
    "--- stdout ---",
    String(stdout || ""),
    "--- stderr ---",
    String(stderr || ""),
    "",
  ].join("\n");
  fs.writeFileSync(logPath, logBody, "utf8");

  const relLog = path.relative(cwdForRelative, logPath) || logPath;
  const relJson = path.relative(cwdForRelative, jsonPath) || jsonPath;

  const payload = {
    ok: false,
    failureKind,
    stage,
    exitCode,
    cacheKey: cacheKeyStr,
    command: commandLine,
    logPath: relLog,
    jsonPath: relJson,
    timestamp: ts,
    stderrTail: String(stderr || "").slice(-8000),
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return { jsonPath: relJson, logPath: relLog, payload };
}

module.exports = { writeMcpIngestFailureArtifact };
