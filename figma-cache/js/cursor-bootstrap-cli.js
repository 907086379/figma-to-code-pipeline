/* eslint-disable no-console */

function readUtf8IfExists(fs, absPath) {
  if (!fs.existsSync(absPath)) {
    return "";
  }
  return fs.readFileSync(absPath, "utf8");
}

function loadManagedManifest({ fs, path, CURSOR_BOOTSTRAP_DIR, normalizeSlash }) {
  const manifestPath = path.join(CURSOR_BOOTSTRAP_DIR, "managed-files.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`[figma-cache] missing managed files manifest: ${normalizeSlash(manifestPath)}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.error(`[figma-cache] invalid managed files manifest: ${error.message}`);
    process.exit(1);
  }

  const { managedFiles, retiredFiles } = parsed || {};
  if (!Array.isArray(managedFiles) || managedFiles.length === 0) {
    console.error("[figma-cache] managed-files.json must contain non-empty managedFiles");
    process.exit(1);
  }

  const pairs = managedFiles.map((item, index) => {
    if (!item || typeof item.from !== "string" || typeof item.to !== "string") {
      console.error(`[figma-cache] invalid managedFiles[${index}] item`);
      process.exit(1);
    }
    return {
      from: item.from,
      to: item.to,
    };
  });

  const retired = Array.isArray(retiredFiles)
    ? retiredFiles.filter((item) => typeof item === "string" && item.trim())
    : [];

  return { pairs, retired };
}

function copyCursorBootstrap(options, deps) {
  const {
    fs,
    path,
    ROOT,
    CACHE_DIR,
    CURSOR_BOOTSTRAP_DIR,
    normalizeSlash,
    readSelfNpmPackageName,
    packageDir,
  } = deps;
  const {
    overwrite = false,
    legacyForce = false,
  } = options || {};

  const { pairs, retired } = loadManagedManifest({ fs, path, CURSOR_BOOTSTRAP_DIR, normalizeSlash });

  if (!fs.existsSync(CURSOR_BOOTSTRAP_DIR)) {
    console.error(
      `[figma-cache] cursor-bootstrap not found at ${normalizeSlash(CURSOR_BOOTSTRAP_DIR)} (broken package install?)`
    );
    process.exit(1);
  }

  let copied = 0;
  let skipped = 0;
  pairs.forEach(({ from: relFrom, to: relTo }) => {
    const absFrom = path.join(CURSOR_BOOTSTRAP_DIR, relFrom);
    const absTo = path.join(ROOT, relTo);
    if (!fs.existsSync(absFrom)) {
      console.error(`[figma-cache] missing template file: ${normalizeSlash(absFrom)}`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    if (fs.existsSync(absTo) && !overwrite) {
      skipped += 1;
      return;
    }
    fs.copyFileSync(absFrom, absTo);
    copied += 1;
  });

  const requiredExampleTemplates = [
    "examples/ui-adapter.contract.template.json",
    "examples/ui-1to1-preflight.template.md",
    "examples/ui-override.template.json",
    "examples/ui-execution-template.fast.md",
    "examples/ui-execution-template.strict.md",
  ];
  requiredExampleTemplates.forEach((relPath) => {
    const absFrom = path.join(CURSOR_BOOTSTRAP_DIR, relPath);
    const absTo = path.join(ROOT, "cursor-bootstrap", relPath);
    if (!fs.existsSync(absFrom)) {
      console.error(`[figma-cache] missing template file: ${normalizeSlash(absFrom)}`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    if (fs.existsSync(absTo) && !overwrite) {
      skipped += 1;
      return;
    }
    fs.copyFileSync(absFrom, absTo);
    copied += 1;
  });
  const retiredDeleted = retired
    .map((relPath) => {
      const abs = path.join(ROOT, relPath);
      if (!fs.existsSync(abs)) {
        return null;
      }
      fs.unlinkSync(abs);
      return normalizeSlash(relPath);
    })
    .filter(Boolean);

  const configTemplatePath = path.join(CURSOR_BOOTSTRAP_DIR, "figma-cache.config.example.js");
  const projectConfigPath = path.join(ROOT, "figma-cache.config.js");
  const legacyExamplePath = path.join(ROOT, "figma-cache.config.example.js");

  if (!fs.existsSync(configTemplatePath)) {
    console.error(`[figma-cache] missing template file: ${normalizeSlash(configTemplatePath)}`);
    process.exit(1);
  }

  const hadProjectConfig = fs.existsSync(projectConfigPath);
  const hadLegacyExample = fs.existsSync(legacyExamplePath);
  const configTemplateBody = fs.readFileSync(configTemplatePath, "utf8");

  let configAction = "skipped";
  let configSource = "existing";
  if (hadProjectConfig && !overwrite) {
    configAction = "skipped";
    configSource = "existing";
  } else if (!hadProjectConfig && hadLegacyExample && !overwrite) {
    fs.copyFileSync(legacyExamplePath, projectConfigPath);
    configAction = "created";
    configSource = "legacy-example";
  } else {
    fs.writeFileSync(projectConfigPath, configTemplateBody, "utf8");
    configAction = hadProjectConfig ? "overwritten" : "created";
    configSource = "template";
  }

  let legacyExampleStatus = "not-found";
  if (fs.existsSync(legacyExamplePath)) {
    const legacyBody = readUtf8IfExists(fs, legacyExamplePath);
    const projectBody = readUtf8IfExists(fs, projectConfigPath);
    const sameAsTemplate = legacyBody === configTemplateBody;
    const sameAsProject = projectBody && legacyBody === projectBody;
    if (sameAsTemplate || sameAsProject) {
      fs.unlinkSync(legacyExamplePath);
      legacyExampleStatus = "deleted";
    } else {
      legacyExampleStatus = "kept-customized";
    }
  }

  const agentSrc = path.join(CURSOR_BOOTSTRAP_DIR, "AGENT-SETUP-PROMPT.md");
  const agentDest = path.join(ROOT, "AGENT-SETUP-PROMPT.md");
  if (!fs.existsSync(agentSrc)) {
    console.error(`[figma-cache] missing ${normalizeSlash(agentSrc)}`);
    process.exit(1);
  }

  let agentBody = fs.readFileSync(agentSrc, "utf8");
  const npmPkg = readSelfNpmPackageName();
  agentBody = agentBody.replace(/\{\{NPM_PACKAGE_NAME\}\}/g, npmPkg);
  fs.writeFileSync(agentDest, agentBody, "utf8");

  const colleagueSrc = path.join(packageDir, "docs", "colleague-guide-zh.md");
  const colleagueDest = path.join(CACHE_DIR, "docs", "colleague-guide-zh.md");
  if (!fs.existsSync(colleagueSrc)) {
    console.error(`[figma-cache] missing ${normalizeSlash(colleagueSrc)} (broken package install?)`);
    process.exit(1);
  }
  const colleagueSameFile = path.resolve(colleagueSrc) === path.resolve(colleagueDest);
  if (!colleagueSameFile) {
    fs.mkdirSync(path.dirname(colleagueDest), { recursive: true });
    fs.copyFileSync(colleagueSrc, colleagueDest);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        root: normalizeSlash(ROOT),
        copied,
        skipped,
        overwrite,
        legacyForce,
        retiredDeleted,
        hint: skipped
          ? "Some template files were skipped (default safe mode keeps existing files)."
          : overwrite
          ? "Done. Existing .cursor templates were overwritten by latest bootstrap."
          : "Done.",
        configFile: normalizeSlash(projectConfigPath),
        configAction,
        configSource,
        legacyExampleFile: normalizeSlash(legacyExamplePath),
        legacyExampleStatus,
        agentPromptFile: normalizeSlash(agentDest),
        colleagueGuideFile: normalizeSlash(colleagueDest),
        colleagueGuideSynced: !colleagueSameFile,
        colleagueGuideNote: colleagueSameFile
          ? "colleague-guide-zh.md already at package path (toolchain dev tree); no copy."
          : "colleague-guide-zh.md refreshed under FIGMA_CACHE_DIR/docs (default figma-cache/docs/).",
        agentPromptNote:
          "AGENT-SETUP-PROMPT.md is refreshed every run. Next: @ it in Cursor; after Agent finishes, run npm run fc:init (or npx figma-cache init if scripts are missing).",
        npmPackageName: npmPkg,
      },
      null,
      2
    )
  );
  console.log(
    "\n" +
      "================================================================\n" +
      "下一步（请按顺序）：\n" +
      "1) 在 Cursor 对话中输入 @AGENT-SETUP-PROMPT.md，并说明「按该文档执行」\n" +
      "   （每次 cursor init 都会刷新该文件；无需再整篇粘贴。）\n" +
      "2) 待 Agent 完成后，在项目根初始化本地缓存索引：\n" +
      "   npm run fc:init\n" +
      "   若尚未补全 npm scripts，请改用：npx figma-cache init\n" +
      "================================================================\n"
  );
}

module.exports = {
  copyCursorBootstrap,
};