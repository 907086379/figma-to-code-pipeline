/* eslint-disable no-console */

function readUtf8IfExists(fs, absPath) {
  if (!fs.existsSync(absPath)) {
    return "";
  }
  return fs.readFileSync(absPath, "utf8");
}

function copyCursorBootstrap(force, deps) {
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

  const pairs = [
    {
      from: path.join("rules", "00-output-token-budget.mdc"),
      to: path.join(".cursor", "rules", "00-output-token-budget.mdc"),
    },
    {
      from: path.join("rules", "01-figma-cache-core.mdc"),
      to: path.join(".cursor", "rules", "01-figma-cache-core.mdc"),
    },
    {
      from: path.join("rules", "02-figma-stack-adapter.mdc"),
      to: path.join(".cursor", "rules", "02-figma-stack-adapter.mdc"),
    },
    {
      from: path.join("rules", "figma-local-cache-first.mdc"),
      to: path.join(".cursor", "rules", "figma-local-cache-first.mdc"),
    },
    {
      from: path.join("skills", "figma-mcp-local-cache", "SKILL.md"),
      to: path.join(".cursor", "skills", "figma-mcp-local-cache", "SKILL.md"),
    },
  ];

  if (!fs.existsSync(CURSOR_BOOTSTRAP_DIR)) {
    console.error(
      `[figma-cache] cursor-bootstrap not found at ${normalizeSlash(CURSOR_BOOTSTRAP_DIR)} (broken package install?)`
    );
    process.exit(1);
  }

  const overwrite = !force;
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
  if (hadProjectConfig && !force) {
    configAction = "skipped";
    configSource = "existing";
  } else if (!hadProjectConfig && hadLegacyExample && !force) {
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
        force: !!force,
        overwriteByDefault: overwrite,
        hint: skipped
          ? "Some template files were skipped (--force means keep existing files)."
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
          "AGENT-SETUP-PROMPT.md is refreshed every run. Next: @ it in Cursor; after Agent finishes, run npm run figma:cache:init (or npx figma-cache init if scripts are missing).",
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
      "   npm run figma:cache:init\n" +
      "   若尚未补全 npm scripts，请改用：npx figma-cache init\n" +
      "================================================================\n"
  );
}

module.exports = {
  copyCursorBootstrap,
};

