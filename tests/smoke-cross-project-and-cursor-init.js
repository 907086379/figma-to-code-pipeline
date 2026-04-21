"use strict";

function runSmokeCrossProjectAndCursorInit(context) {
  const {
    assert,
    execSync,
    fs,
    os,
    path,
    root,
    expectThrow,
    runInDir
  } = context;

  // package files: should ship core UI scripts (explicit paths or scripts/*.js glob)
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const files = Array.isArray(pkg.files) ? pkg.files : [];
    const scriptGlobs = files.includes("scripts/*.js") || files.includes("scripts/**/*.js");
    const requiredScripts = [
      "scripts/ui/ui-auto-acceptance.js",
      "scripts/ui/ui-preflight.js",
      "scripts/ui/ui-1to1-audit.js",
      "scripts/ui/ui-report-aggregate.js"
    ];
    for (const rel of requiredScripts) {
      const listed = files.includes(rel) || scriptGlobs;
      assert.ok(listed, `package files should include ${rel} (or scripts/*.js)`);
      assert.ok(fs.existsSync(path.join(root, rel)), `expected script on disk: ${rel}`);
    }
  }

  // cursor init: should ensure figma-cache.config.js and cleanup safe legacy example
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figma-cache-smoke-cursor-init-"));
    const cacheDir = path.join(tempRoot, "figma-cache");
    const env = {
      FIGMA_CACHE_DIR: cacheDir,
      FIGMA_CACHE_INDEX_FILE: "index.json",
    };

    const legacyExamplePath = path.join(tempRoot, "figma-cache.config.example.js");
    fs.writeFileSync(legacyExamplePath, "module.exports = { hooks: { postEnsure() {} } };\n", "utf8");

    const initOutput = runInDir("cursor init", tempRoot, env);
    const firstJson = initOutput.split(/\r?\n\r?\n/)[0];
    const initResult = JSON.parse(firstJson);
    assert.strictEqual(initResult.ok, true);

    const configPath = path.join(tempRoot, "figma-cache.config.js");
    assert.ok(fs.existsSync(configPath), "cursor init should create figma-cache.config.js");
    assert.ok(!fs.existsSync(legacyExamplePath), "cursor init should cleanup identical legacy example");

    const configBody = fs.readFileSync(configPath, "utf8");
    assert.ok(configBody.includes("module.exports"), "generated config should be valid JS module");

    const contractTemplatePath = path.join(tempRoot, "cursor-bootstrap", "examples", "ui-adapter.contract.template.json");
    const preflightTemplatePath = path.join(tempRoot, "cursor-bootstrap", "examples", "ui-1to1-preflight.template.md");
    const fastTemplatePath = path.join(tempRoot, "cursor-bootstrap", "examples", "ui-execution-template.fast.md");
    const strictTemplatePath = path.join(tempRoot, "cursor-bootstrap", "examples", "ui-execution-template.strict.md");
    const overrideTemplatePath = path.join(tempRoot, "cursor-bootstrap", "examples", "ui-override.template.json");
    assert.ok(fs.existsSync(contractTemplatePath), "cursor init should copy ui-adapter contract template to project");
    assert.ok(fs.existsSync(preflightTemplatePath), "cursor init should copy ui preflight template to project");
    assert.ok(fs.existsSync(fastTemplatePath), "cursor init should copy fast execution template");
    assert.ok(fs.existsSync(strictTemplatePath), "cursor init should copy strict execution template");
    assert.ok(fs.existsSync(overrideTemplatePath), "cursor init should copy override template");

    const keepExistingOutput = runInDir("cursor init", tempRoot, env);
    const keepResult = JSON.parse(keepExistingOutput.split(/\r?\n\r?\n/)[0]);
    assert.ok(keepResult.skipped >= 1, "default cursor init should keep existing .cursor templates");

    const overwriteOutput = runInDir("cursor init --overwrite", tempRoot, env);
    const overwriteResult = JSON.parse(overwriteOutput.split(/\r?\n\r?\n/)[0]);
    assert.strictEqual(overwriteResult.overwrite, true, "cursor init --overwrite should enable overwrite mode");

    const forceOutput = runInDir("cursor init --force", tempRoot, env);
    const forceResult = JSON.parse(forceOutput.split(/\r?\n\r?\n/)[0]);
    assert.strictEqual(forceResult.overwrite, false, "cursor init --force should keep legacy no-overwrite behavior");

    const conflictErr = expectThrow(
      () => runInDir("cursor init --overwrite --force", tempRoot, env),
      "cursor init should reject conflicting overwrite/force flags"
    );
    assert.ok(conflictErr.status > 0, "cursor init conflict flags should exit non-zero");

    const retiredSkillDir = path.join(tempRoot, ".cursor", "skills", "ui-baseline-governance");
    fs.mkdirSync(retiredSkillDir, { recursive: true });
    fs.writeFileSync(path.join(retiredSkillDir, "SKILL.md"), "legacy skill", "utf8");

    runInDir("cursor init", tempRoot, env);
    assert.ok(
      !fs.existsSync(path.join(retiredSkillDir, "SKILL.md")),
      "cursor init should remove retired managed files from manifest"
    );
  }

  if (process.platform === "win32") {
    const strictErr = expectThrow(
      () =>
        execSync(
          `powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "${path.join(
            root,
            "scripts",
            "preflight.ps1"
          )}" -Mode strict`,
          {
            cwd: root,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          }
        ),
      "preflight strict should fail in Windows PowerShell host"
    );
    assert.strictEqual(strictErr.status, 2, "preflight strict should exit with code 2");
  }
}

module.exports = {
  runSmokeCrossProjectAndCursorInit,
};
