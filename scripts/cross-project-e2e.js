#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { readBatchV2 } = require("./ui-batch-v2.cjs");

const ROOT = process.cwd();
const FAIL_EXIT_CODE = 2;

function resolveMaybeAbsolutePath(input) {
  if (!input) {
    return "";
  }
  return path.isAbsolute(input) ? path.normalize(input) : path.join(ROOT, input);
}

/** Batch / CLI `target` paths are relative to the target business project root (not toolchain cwd). */
function resolveTargetInProject(rawTarget, targetProject) {
  if (!rawTarget) {
    return "";
  }
  const trimmed = String(rawTarget).trim();
  if (!trimmed) {
    return "";
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  return path.join(targetProject, trimmed);
}

function parseArgs(argv) {
  const options = {
    targetProject: "",
    cacheKey: "",
    fileKey: "",
    nodeId: "",
    target: "",
    minScore: 90,
    maxWarnings: 0,
    maxDiffs: 2,
    profile: "",
    keepPackage: false,
    autoBootstrapContract: true,
    autoEnsureOnMiss: false,
    allowSkeletonWithFigmaMcp: false,
    // Default to "best effort" evidence to support 1:1 audits out-of-the-box.
    completeness: "layout,text,tokens,assets,interactions,states,accessibility",
    batchFile: "",
    fixLoop: 0,
    emitAgentTaskOnFail: false,
    agentTaskPath: "",
    allowSkippedCodeLevelComparison: false,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--target-project=")) {
      options.targetProject = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--cacheKey=")) {
      options.cacheKey = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--fileKey=")) {
      options.fileKey = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--nodeId=")) {
      options.nodeId = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--target=")) {
      options.target = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--min-score=")) {
      const n = Number(arg.split("=").slice(1).join("=").trim());
      options.minScore = Number.isFinite(n) ? n : options.minScore;
      return;
    }
    if (arg.startsWith("--max-warnings=")) {
      const n = Number(arg.split("=").slice(1).join("=").trim());
      options.maxWarnings = Number.isFinite(n) ? n : options.maxWarnings;
      return;
    }
    if (arg.startsWith("--max-diffs=")) {
      const n = Number(arg.split("=").slice(1).join("=").trim());
      options.maxDiffs = Number.isFinite(n) ? n : options.maxDiffs;
      return;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg === "--keep-package") {
      options.keepPackage = true;
      return;
    }
    if (arg === "--no-auto-bootstrap-contract") {
      options.autoBootstrapContract = false;
      return;
    }
    if (arg === "--auto-ensure-on-miss") {
      options.autoEnsureOnMiss = true;
      return;
    }
    if (arg === "--allow-skeleton-with-figma-mcp") {
      options.allowSkeletonWithFigmaMcp = true;
      return;
    }
    if (arg.startsWith("--completeness=")) {
      options.completeness = arg.split("=").slice(1).join("=").trim() || options.completeness;
      return;
    }
    if (arg.startsWith("--batch-file=")) {
      options.batchFile = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg.startsWith("--fix-loop=")) {
      const n = Number(arg.split("=").slice(1).join("=").trim());
      options.fixLoop = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      return;
    }
    if (arg === "--emit-agent-task-on-fail") {
      options.emitAgentTaskOnFail = true;
      return;
    }
    if (arg.startsWith("--agent-task-path=")) {
      options.agentTaskPath = arg.split("=").slice(1).join("=").trim();
      return;
    }
    if (arg === "--allow-skipped-code-level-comparison") {
      options.allowSkippedCodeLevelComparison = true;
    }
  });

  return options;
}

function runCommand(command, cwd, extraEnv) {
  return execSync(command, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(extraEnv || {}),
    },
  });
}

function normalizeNodeId(input) {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }
  return value.includes(":") ? value : value.replace(/-/g, ":");
}

function resolveCacheKey(options) {
  if (options.cacheKey) {
    return options.cacheKey;
  }
  if (options.fileKey && options.nodeId) {
    return `${options.fileKey}#${normalizeNodeId(options.nodeId)}`;
  }
  return "";
}

function npmPackAndGetTarball() {
  const raw = runCommand("npm pack", ROOT);
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fileName = [...lines].reverse().find((line) => /\.tgz$/i.test(line));
  if (!fileName) {
    throw new Error("npm pack returned no tarball name");
  }
  return path.join(ROOT, fileName);
}

function ensureCursorBootstrapFiles(targetProject) {
  const required = ["ui-hard-constraints.json", "ui-policy.json"];
  const missing = required.filter((name) => !fs.existsSync(path.join(targetProject, name)));
  if (!missing.length) {
    return { ok: true, ran: false, missing: [] };
  }
  const binAbs = path.join(
    targetProject,
    "node_modules",
    "figma-to-code-pipeline",
    "bin",
    "figma-cache.js"
  );
  if (!fs.existsSync(binAbs)) {
    // If the package isn't installed yet, caller will re-run after install.
    return { ok: false, ran: false, missing, reason: `figma-cache bin missing: ${binAbs}` };
  }
  // Safe mode: do not overwrite existing files; only fill missing bootstrap artifacts.
  runCommand(`node "${binAbs}" cursor init`, targetProject);
  const stillMissing = required.filter((name) => !fs.existsSync(path.join(targetProject, name)));
  if (stillMissing.length) {
    return { ok: false, ran: true, missing: stillMissing, reason: "cursor init did not write required files" };
  }
  return { ok: true, ran: true, missing: [] };
}

function readJsonOrNull(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeSlash(input) {
  return String(input || "").replace(/\\/g, "/");
}

function writeAgentTask(targetProject, options, payload) {
  const defaultPath = path.join(targetProject, "agent-task.md");
  const taskPath = options.agentTaskPath
    ? resolveMaybeAbsolutePath(options.agentTaskPath)
    : defaultPath;
  const lines = [];
  lines.push("# Agent 任务：UI E2E 修复接力");
  lines.push("");
  lines.push("## 目标");
  lines.push("修复目标项目实现，使 UI 验收链路通过。");
  lines.push("");
  lines.push("## 约束");
  lines.push("- 修改代码后必须运行 UI 验收。");
  lines.push("- 未明确要求时，不要通过降低阈值来绕过失败。");
  lines.push("- 优先修复真实组件/contract/recipe 等根因。");
  lines.push("");
  lines.push("## 上下文");
  lines.push(`- targetProject: ${normalizeSlash(payload.targetProject || "")}`);
  lines.push(`- mode: ${payload.mode || "single"}`);
  lines.push(`- profile: ${payload.profile || "standard"}`);
  lines.push(`- autoEnsureOnMiss: ${payload.autoEnsureOnMiss ? "true" : "false"}`);
  lines.push(`- fixLoop: ${Number(payload.fixLoop || 0)}`);
  lines.push("");
  lines.push("## 失败用例");
  (payload.cases || []).forEach((entry, idx) => {
    lines.push(`### Case ${idx + 1}`);
    lines.push(`- cacheKey: ${entry.cacheKey || ""}`);
    lines.push(`- targetPath: ${normalizeSlash(entry.targetPath || "")}`);
    lines.push(`- reason: ${entry.reason || "unknown"}`);
    if (entry.attemptLogs && entry.attemptLogs.length) {
      lines.push("- attemptLogs:");
      entry.attemptLogs.forEach((log) => {
        lines.push(
          `  - attempt ${log.attempt}: ${log.ok ? "ok" : "fail"}${log.reason ? ` (${log.reason})` : ""}`
        );
      });
    }
    lines.push("");
  });
  lines.push("## 必须执行的命令");
  lines.push("修复完成后，在 toolchain 仓库重新运行：");
  lines.push("");
  lines.push("```bash");
  lines.push(payload.retryCommand || "npm run fc:ui:e2e:cross -- --target-project=<...>");
  lines.push("```");
  lines.push("");
  lines.push("## 完成标准");
  lines.push("- e2e 命令退出码为 0");
  lines.push("- summaryStatus 为 healthy");
  lines.push("- 无未解决的 blocking 项");
  lines.push("");

  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, `${lines.join("\n")}\n`, "utf8");
  return taskPath;
}

function parseCacheKey(cacheKey) {
  const value = String(cacheKey || "").trim();
  const [fileKey, nodeId] = value.split("#");
  if (!fileKey || !nodeId) {
    return null;
  }
  return {
    fileKey,
    nodeId,
  };
}

function buildFigmaUrl(fileKey, nodeId) {
  const normalizedNodeId = String(nodeId || "").replace(/:/g, "-");
  return `https://www.figma.com/file/${fileKey}/auto-e2e?node-id=${normalizedNodeId}`;
}

function readTargetIndexItem(targetProject, cacheKey) {
  const indexPath = path.join(targetProject, "figma-cache", "index.json");
  const index = readJsonOrNull(indexPath);
  const items = index && index.items && typeof index.items === "object" ? index.items : {};
  return items[cacheKey] || null;
}

function ensureCacheViaFigmaMcp(targetProject, cacheKey, options) {
  const parsed = parseCacheKey(cacheKey);
  if (!parsed) {
    throw new Error(`invalid cacheKey for auto ensure: ${cacheKey}`);
  }
  const cliPath = path.join(
    targetProject,
    "node_modules",
    "figma-to-code-pipeline",
    "bin",
    "figma-cache.js"
  );
  if (!fs.existsSync(cliPath)) {
    throw new Error("figma-cache cli not found in target project node_modules");
  }
  const figmaUrl = buildFigmaUrl(parsed.fileKey, parsed.nodeId);
  const args = [
    `node "${cliPath}"`,
    "ensure",
    `"${figmaUrl}"`,
    "--source=figma-mcp",
    `--completeness=${options.completeness}`,
  ];
  if (options.allowSkeletonWithFigmaMcp) {
    args.push("--allow-skeleton-with-figma-mcp");
  }
  runCommand(args.join(" "), targetProject);
}

function bootstrapContractIfNeeded(targetProject, options) {
  if (!options.autoBootstrapContract) {
    return;
  }
  const contractPath = path.join(targetProject, "figma-cache", "adapters", "ui-adapter.contract.json");
  if (fs.existsSync(contractPath)) {
    return;
  }
  const templatePath = path.join(
    targetProject,
    "node_modules",
    "figma-to-code-pipeline",
    "cursor-bootstrap",
    "examples",
    "ui-adapter.contract.template.json"
  );
  if (fs.existsSync(templatePath)) {
    fs.mkdirSync(path.dirname(contractPath), { recursive: true });
    fs.copyFileSync(templatePath, contractPath);
  }
}

function runSingleCase(input, context) {
  const { targetProject, acceptScriptPath, options } = context;
  const item = {
    cacheKey: input.cacheKey || "",
    fileKey: input.fileKey || "",
    nodeId: input.nodeId || "",
    target: input.target || options.target || "",
    minScore: Number.isFinite(Number(input.minScore)) ? Number(input.minScore) : options.minScore,
    maxWarnings: Number.isFinite(Number(input.maxWarnings))
      ? Number(input.maxWarnings)
      : options.maxWarnings,
    maxDiffs: Number.isFinite(Number(input.maxDiffs)) ? Number(input.maxDiffs) : options.maxDiffs,
    auditMode: input.auditMode || "",
    targetKind: input.targetKind || "",
  };
  const cacheKey = item.cacheKey || resolveCacheKey(item);
  if (!cacheKey) {
    throw new Error("batch item missing cacheKey or (fileKey + nodeId)");
  }
  const targetPath = item.target ? resolveTargetInProject(item.target, targetProject) : "";
  if (!targetPath) {
    throw new Error(`batch item ${cacheKey} missing target path`);
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error(`batch item ${cacheKey} target path does not exist: ${targetPath}`);
  }

  const acceptArgs = [
    `--cacheKey=${cacheKey}`,
    `--target=${targetPath}`,
    `--min-score=${item.minScore}`,
    `--max-warnings=${item.maxWarnings}`,
    `--max-diffs=${item.maxDiffs}`,
  ];
  if (item.auditMode) {
    acceptArgs.push(`--audit-mode=${item.auditMode}`);
  }
  if (item.targetKind) {
    acceptArgs.push(`--target-kind=${item.targetKind}`);
  }
  const env = {};
  if (options.profile) {
    env.FIGMA_UI_PROFILE = options.profile;
  }
  let attempt = 0;
  let lastError = "";
  let acceptanceJson = null;
  const attemptLogs = [];
  const maxAttempts = 1 + options.fixLoop;
  while (attempt < maxAttempts) {
    attempt += 1;
    let itemExists = !!readTargetIndexItem(targetProject, cacheKey);
    if (!itemExists && options.autoEnsureOnMiss) {
      ensureCacheViaFigmaMcp(targetProject, cacheKey, options);
      itemExists = !!readTargetIndexItem(targetProject, cacheKey);
    }
    if (!itemExists) {
      lastError = `cacheKey miss: ${cacheKey}. try --auto-ensure-on-miss or pre-populate cache`;
      attemptLogs.push({ attempt, ok: false, reason: lastError });
      if (attempt >= maxAttempts) {
        break;
      }
      continue;
    }
    try {
      const acceptanceOutput = runCommand(
        `node "${acceptScriptPath}" ${acceptArgs.join(" ")}`,
        targetProject,
        env
      );
      try {
        acceptanceJson = JSON.parse(acceptanceOutput);
      } catch {}
      if (
        !options.allowSkippedCodeLevelComparison &&
        acceptanceJson &&
        Array.isArray(acceptanceJson.warnings) &&
        acceptanceJson.warnings.some((entry) =>
          /code-level comparison skipped/i.test(String(entry || ""))
        )
      ) {
        throw new Error(
          `acceptance produced skipped code-level comparison for ${cacheKey}; target linkage is invalid`
        );
      }
      attemptLogs.push({ attempt, ok: true });
      return {
        ok: true,
        cacheKey,
        targetPath: normalizeSlash(targetPath),
        acceptance: acceptanceJson,
        attempts: attempt,
        attemptLogs,
      };
    } catch (error) {
      lastError = error && error.message ? error.message : "unknown acceptance error";
      attemptLogs.push({ attempt, ok: false, reason: lastError });
      if (attempt >= maxAttempts) {
        break;
      }
      // self-healing retry: re-bootstrap contract + refresh cache evidence when enabled
      bootstrapContractIfNeeded(targetProject, options);
      if (options.autoEnsureOnMiss) {
        try {
          ensureCacheViaFigmaMcp(targetProject, cacheKey, options);
        } catch {}
      }
    }
  }
  throw new Error(
    `acceptance failed after ${maxAttempts} attempts for ${cacheKey}: ${lastError}`
  );
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const targetProject = resolveMaybeAbsolutePath(options.targetProject);
  if (!targetProject || !fs.existsSync(targetProject)) {
    console.error("cross-project-e2e failed: --target-project is required and must exist");
    process.exit(FAIL_EXIT_CODE);
  }
  const isBatchMode = !!options.batchFile;
  if (!isBatchMode) {
    const targetPath = options.target ? resolveTargetInProject(options.target, targetProject) : "";
    if (!targetPath) {
      console.error("cross-project-e2e failed: --target is required for real component validation");
      process.exit(FAIL_EXIT_CODE);
    }
    if (!fs.existsSync(targetPath)) {
      console.error(`cross-project-e2e failed: --target path does not exist: ${targetPath}`);
      process.exit(FAIL_EXIT_CODE);
    }
    const cacheKey = resolveCacheKey(options);
    if (!cacheKey) {
      console.error("cross-project-e2e failed: provide --cacheKey or (--fileKey + --nodeId)");
      process.exit(FAIL_EXIT_CODE);
    }
  }

  let tarballPath = "";
  let taskPayload = null;
  try {
    tarballPath = npmPackAndGetTarball();
    runCommand(`npm i -D "${tarballPath}"`, targetProject);

    // Ensure toolchain bootstrap artifacts are present in target project (for new repos / new agents).
    // This makes cross-project workflow self-contained and avoids "forgot to cursor init" drift.
    const bootstrap = ensureCursorBootstrapFiles(targetProject);
    if (!bootstrap.ok) {
      throw new Error(
        `cursor bootstrap incomplete: ${bootstrap.reason || "unknown"}; missing: ${JSON.stringify(
          bootstrap.missing || []
        )}`
      );
    }

    const acceptScript = path.join(
      targetProject,
      "node_modules",
      "figma-to-code-pipeline",
      "scripts",
      "ui-auto-acceptance.js"
    );
    if (!fs.existsSync(acceptScript)) {
      throw new Error("ui-auto-acceptance.js not found in installed package; check package files field");
    }
    bootstrapContractIfNeeded(targetProject, options);

    const cases = isBatchMode
      ? (() => {
          const batchPath = resolveMaybeAbsolutePath(options.batchFile);
          const batch = readBatchV2(batchPath, path.dirname(batchPath));
          return batch.cases.map((c) => ({
            cacheKey: c.cacheKey,
            target: c.target.entry,
            minScore: c.limits.minScore,
            maxWarnings: c.limits.maxWarnings,
            maxDiffs: c.limits.maxDiffs,
            auditMode: c.audit && c.audit.mode ? c.audit.mode : "",
            targetKind: c.target && c.target.kind ? c.target.kind : "",
          }));
        })()
      : [
          {
            cacheKey: options.cacheKey,
            fileKey: options.fileKey,
            nodeId: options.nodeId,
            target: options.target,
            minScore: options.minScore,
            maxWarnings: options.maxWarnings,
            maxDiffs: options.maxDiffs,
          },
        ];

    const caseResults = [];
    const caseFailures = [];
    cases.forEach((entry, indexNo) => {
      try {
        caseResults.push(
          runSingleCase(entry, {
            targetProject,
            acceptScriptPath: acceptScript,
            options,
          })
        );
      } catch (error) {
        caseFailures.push({
          index: indexNo,
          cacheKey: entry && (entry.cacheKey || resolveCacheKey(entry)),
          targetPath: entry && entry.target,
          attemptLogs: [],
          reason: error.message,
        });
      }
    });
    if (caseFailures.length) {
      taskPayload = {
        targetProject,
        mode: isBatchMode ? "batch" : "single",
        profile: options.profile || "standard",
        autoEnsureOnMiss: options.autoEnsureOnMiss,
        fixLoop: options.fixLoop,
        cases: caseFailures,
        retryCommand: `npm run fc:ui:e2e:cross -- --target-project=${normalizeSlash(
          targetProject
        )}${options.batchFile ? ` --batch-file=${normalizeSlash(options.batchFile)}` : ""}${
          options.autoEnsureOnMiss ? " --auto-ensure-on-miss" : ""
        }${options.fixLoop ? ` --fix-loop=${options.fixLoop}` : ""}`,
      };
      throw new Error(`batch cases failed: ${JSON.stringify(caseFailures)}`);
    }

    const reportBase = path.join(targetProject, "figma-cache", "reports");
    const output = {
      ok: true,
      generatedAt: new Date().toISOString(),
      targetProject,
      mode: isBatchMode ? "batch" : "single",
      profile: options.profile || null,
      autoEnsureOnMiss: options.autoEnsureOnMiss,
      allowSkeletonWithFigmaMcp: options.allowSkeletonWithFigmaMcp,
      completeness: options.completeness,
      tarballPath,
      reports: {
        preflight: path.join(reportBase, "runtime", "ui-preflight-report.json"),
        audit: path.join(reportBase, "runtime", "ui-1to1-report.json"),
        summary: path.join(reportBase, "runtime", "ui-quality-summary.json"),
      },
      cases: caseResults,
    };

    const summary = readJsonOrNull(output.reports.summary);
    if (summary) {
      output.summaryMetrics = summary.metrics || null;
      output.summaryStatus = summary.trend && summary.trend.status;
    }
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    let taskPath = "";
    if (options.emitAgentTaskOnFail) {
      try {
        const payload =
          taskPayload ||
          ({
            targetProject,
            mode: isBatchMode ? "batch" : "single",
            profile: options.profile || "standard",
            autoEnsureOnMiss: options.autoEnsureOnMiss,
            fixLoop: options.fixLoop,
            cases: [
              {
                cacheKey: resolveCacheKey(options),
                targetPath: options.target,
                reason: error.message,
              },
            ],
            retryCommand: `npm run fc:ui:e2e:cross -- --target-project=${normalizeSlash(
              targetProject
            )}${options.batchFile ? ` --batch-file=${normalizeSlash(options.batchFile)}` : ""}${
              options.cacheKey ? ` --cacheKey=${options.cacheKey}` : ""
            }${options.fileKey ? ` --fileKey=${options.fileKey}` : ""}${
              options.nodeId ? ` --nodeId=${options.nodeId}` : ""
            }${options.target ? ` --target=${normalizeSlash(options.target)}` : ""}${
              options.autoEnsureOnMiss ? " --auto-ensure-on-miss" : ""
            }${options.fixLoop ? ` --fix-loop=${options.fixLoop}` : ""} --emit-agent-task-on-fail`,
          });
        taskPath = writeAgentTask(targetProject, options, payload);
      } catch {}
    }
    console.error("cross-project-e2e failed:");
    console.error(`- ${error.message}`);
    if (taskPath) {
      console.error(`- agent task emitted: ${normalizeSlash(taskPath)}`);
    }
    process.exit(FAIL_EXIT_CODE);
  } finally {
    if (tarballPath && !options.keepPackage) {
      try {
        fs.unlinkSync(tarballPath);
      } catch {}
    }
  }
}

run();
