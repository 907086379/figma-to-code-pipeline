#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();
const FAIL_EXIT_CODE = 2;

function resolveMaybeAbsolutePath(input) {
  if (!input) {
    return "";
  }
  return path.isAbsolute(input) ? path.normalize(input) : path.join(ROOT, input);
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
    completeness: "layout,text,tokens,interactions,states,accessibility",
    batchFile: "",
    fixLoop: 0,
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
    "figma-cache-toolchain",
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
    "figma-cache-toolchain",
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
  };
  const cacheKey = item.cacheKey || resolveCacheKey(item);
  if (!cacheKey) {
    throw new Error("batch item missing cacheKey or (fileKey + nodeId)");
  }
  const targetPath = item.target ? resolveMaybeAbsolutePath(item.target) : "";
  if (!targetPath) {
    throw new Error(`batch item ${cacheKey} missing target path`);
  }

  const acceptArgs = [
    `--cacheKey=${cacheKey}`,
    `--target=${targetPath}`,
    `--min-score=${item.minScore}`,
    `--max-warnings=${item.maxWarnings}`,
    `--max-diffs=${item.maxDiffs}`,
  ];
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
    const targetPath = options.target ? resolveMaybeAbsolutePath(options.target) : "";
    if (!targetPath) {
      console.error("cross-project-e2e failed: --target is required for real component validation");
      process.exit(FAIL_EXIT_CODE);
    }
    const cacheKey = resolveCacheKey(options);
    if (!cacheKey) {
      console.error("cross-project-e2e failed: provide --cacheKey or (--fileKey + --nodeId)");
      process.exit(FAIL_EXIT_CODE);
    }
  }

  let tarballPath = "";
  try {
    tarballPath = npmPackAndGetTarball();
    runCommand(`npm i -D "${tarballPath}"`, targetProject);

    const acceptScript = path.join(
      targetProject,
      "node_modules",
      "figma-cache-toolchain",
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
          const payload = readJsonOrNull(batchPath);
          if (!Array.isArray(payload) || !payload.length) {
            throw new Error(`invalid batch file: ${batchPath}`);
          }
          return payload;
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
          reason: error.message,
        });
      }
    });
    if (caseFailures.length) {
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
        preflight: path.join(reportBase, "ui-preflight-report.json"),
        audit: path.join(reportBase, "ui-1to1-report.json"),
        summary: path.join(reportBase, "ui-quality-summary.json"),
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
    console.error("cross-project-e2e failed:");
    console.error(`- ${error.message}`);
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
