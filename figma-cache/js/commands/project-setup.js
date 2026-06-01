/* eslint-disable no-console */

const {
  readManifest,
  ensurePendingProjectSetupManifest,
  evaluateProjectSetup,
  finishProjectSetup,
  MANIFEST_BASENAME,
} = require("../project-setup");

module.exports = function handleProjectSetup(args, context) {
  const {
    parseTailWithCli,
    root,
    cacheDir,
    fs,
    path,
    normalizeSlash,
    loadProjectConfig,
    getProjectConfigPath,
  } = context;

  const sub = (args[0] || "").trim();
  const rest = args.slice(1);
  const { flags } = parseTailWithCli(rest, {
    strings: [],
    booleanFlags: ["json"],
  });

  const deps = {
    fs,
    path,
    root,
    cacheDir,
    loadProjectConfig,
    getProjectConfigPath,
  };

  if (sub === "init" || sub === "pending") {
    const manifest = ensurePendingProjectSetupManifest(deps);
    const out = {
      ok: true,
      action: "pending",
      manifestPath: normalizeSlash(
        path.join(cacheDir, MANIFEST_BASENAME).replace(/\\/g, "/"),
      ),
      manifest,
    };
    if (flags.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`project-setup: wrote pending manifest (${out.manifestPath})`);
    }
    return;
  }

  if (sub === "status") {
    const report = evaluateProjectSetup(deps, { requireManifestComplete: false });
    const manifest = readManifest(fs, cacheDir);
    const out = {
      ok: report.ok,
      manifest,
      stackAdapters: report.stackAdapters,
      projectConfigPath: report.projectConfigPath,
      errors: report.errors,
      warnings: report.warnings,
    };
    if (flags.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`project-setup status: ${report.ok ? "ready-to-finish or complete" : "incomplete"}`);
      report.errors.forEach((e) => console.error(`- ${e}`));
      report.warnings.forEach((w) => console.warn(`- ${w}`));
      if (manifest && manifest.status === "complete") {
        console.log(`- manifest: complete (${manifest.completedAt || ""})`);
      }
    }
    if (!report.ok && manifest && manifest.status !== "complete") {
      process.exit(2);
    }
    return;
  }

  if (sub === "finish") {
    const result = finishProjectSetup(deps);
    if (!result.ok) {
      console.error("project-setup finish failed:");
      result.report.errors.forEach((e) => console.error(`- ${e}`));
      process.exit(2);
    }
    const out = {
      ok: true,
      action: "complete",
      manifest: result.manifest,
    };
    if (flags.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log("project-setup finish: complete");
      console.log(`- stack adapters: ${result.report.stackAdapters.join(", ")}`);
      console.log(`- config: ${result.report.projectConfigPath || "(none)"}`);
    }
    return;
  }

  console.error(
    "Usage: figma-cache project-setup <init|status|finish> [--json]\n" +
      "  init     Write pending manifest (cursor init calls this)\n" +
      "  status   Report setup checks (non-zero if blocking before finish)\n" +
      "  finish   Validate adapter/config and mark manifest complete",
  );
  process.exit(1);
};
