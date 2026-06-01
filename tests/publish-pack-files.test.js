#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const {
  expandFilesField,
  getPackCandidatePaths,
  npmPackTarballBasename,
  npmPackTarballPrefix,
} = require("../scripts/publish/expand-package-files.cjs");
const { materializeFileAt } = require("../scripts/publish/materialize-pack-files.cjs");
const { removeStalePackTgz } = require("../scripts/publish/remove-stale-pack-tgz.cjs");
const { resolveExpectedTgz } = require("../scripts/publish/verify-tarball-no-hardlinks.cjs");

function runExpandFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-pack-expand-"));
  try {
    fs.mkdirSync(path.join(root, "scripts", "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "a.js"), "a");
    fs.writeFileSync(path.join(root, "scripts", "sub", "b.cjs"), "b");
    fs.writeFileSync(path.join(root, "scripts", "skip.ps1"), "ps");

    const packed = expandFilesField(root, {
      files: ["scripts/**/*.js", "scripts/**/*.cjs"],
    });

    assert.ok(packed.has("scripts/a.js"));
    assert.ok(packed.has("scripts/sub/b.cjs"));
    assert.ok(!packed.has("scripts/skip.ps1"), "scripts/**/*.js|cjs must not include .ps1");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runPackCandidatesFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-pack-candidates-"));
  try {
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    fs.writeFileSync(path.join(root, "README.md"), "# x");
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), "# c");

    const paths = getPackCandidatePaths(root, { files: [] });
    assert.ok(paths.has("package.json"));
    assert.ok(paths.has("README.md"));
    assert.ok(paths.has("CHANGELOG.md"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runTarballNameFixture() {
  assert.strictEqual(
    npmPackTarballBasename("figma-to-code-pipeline", "4.4.0"),
    "figma-to-code-pipeline-4.4.0.tgz",
  );
  assert.strictEqual(
    npmPackTarballBasename("@scope/my-pkg", "1.0.0"),
    "scope-my-pkg-1.0.0.tgz",
  );
  assert.strictEqual(npmPackTarballPrefix("@scope/my-pkg"), "scope-my-pkg-");
}

function runMaterializeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-pack-mat-"));
  try {
    const f1 = path.join(root, "a.txt");
    const f2 = path.join(root, "b.txt");
    fs.writeFileSync(f1, "linked");
    fs.linkSync(f1, f2);

    const r1 = materializeFileAt(root, "a.txt");
    assert.strictEqual(r1.materialized, true);
    assert.strictEqual(fs.readFileSync(f1, "utf8"), "linked");
    assert.strictEqual(fs.readFileSync(f2, "utf8"), "linked");

    const r2 = materializeFileAt(root, "b.txt");
    assert.strictEqual(r2.materialized, false, "second path should have nlink 1 after first break");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runRemoveStaleFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-pack-stale-"));
  try {
    const pkg = { name: "demo-pkg", version: "2.0.0" };
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    fs.writeFileSync(path.join(root, "demo-pkg-1.0.0.tgz"), "old");
    fs.writeFileSync(path.join(root, "demo-pkg-2.0.0.tgz"), "keep");

    removeStalePackTgz(root, pkg, { log: false });

    assert.ok(!fs.existsSync(path.join(root, "demo-pkg-1.0.0.tgz")));
    assert.ok(fs.existsSync(path.join(root, "demo-pkg-2.0.0.tgz")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runResolveExpectedTgzFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-pack-resolve-"));
  try {
    const pkg = { name: "@acme/widget", version: "3.1.0" };
    const expected = "acme-widget-3.1.0.tgz";

    let r = resolveExpectedTgz(root, pkg);
    assert.strictEqual(r.status, "not_found");
    assert.strictEqual(r.expectedBase, expected);

    fs.writeFileSync(path.join(root, expected), "ok");
    r = resolveExpectedTgz(root, pkg);
    assert.strictEqual(r.status, "found");
    assert.ok(r.path.endsWith(expected));

    fs.writeFileSync(path.join(root, "acme-widget-2.0.0.tgz"), "stale");
    r = resolveExpectedTgz(root, pkg);
    assert.strictEqual(r.status, "found");

    fs.unlinkSync(path.join(root, expected));
    r = resolveExpectedTgz(root, pkg);
    assert.strictEqual(r.status, "stale");
    assert.deepStrictEqual(r.stale, ["acme-widget-2.0.0.tgz"]);

    assert.strictEqual(resolveExpectedTgz(root, {}).status, "missing_meta");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runRemoveStaleErrorsFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-pack-unlink-"));
  try {
    const pkg = { name: "x-pkg", version: "1.0.0" };
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    const stalePath = path.join(root, "x-pkg-0.9.0.tgz");
    fs.writeFileSync(stalePath, "x");
    if (process.platform === "win32") {
      fs.chmodSync(stalePath, 0o444);
    } else {
      fs.chmodSync(root, 0o500);
    }
    let threw = false;
    try {
      removeStalePackTgz(root, pkg, { log: false });
    } catch (e) {
      threw = true;
      assert.strictEqual(e.code, "REMOVE_STALE_FAILED");
    } finally {
      if (process.platform === "win32") {
        fs.chmodSync(stalePath, 0o666);
      } else {
        fs.chmodSync(root, 0o700);
      }
    }
    assert.ok(threw, "removeStalePackTgz should throw when unlink fails");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runTarballHardlinkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-pack-tar-"));
  try {
    const f1 = path.join(root, "f1.txt");
    const f2 = path.join(root, "f2.txt");
    fs.writeFileSync(f1, "x");
    fs.linkSync(f1, f2);
    execSync("tar -cf test.tar f1.txt f2.txt", { cwd: root });

    const listing = execSync("tar -tvf test.tar", { cwd: root, encoding: "utf8" });
    const hardlines = listing.split(/\r?\n/).filter((line) => /^h/i.test(line.trim()));
    assert.ok(hardlines.length >= 1, "fixture tarball should contain hard link listing");

    const verifyScript = path.join(__dirname, "..", "scripts", "publish", "verify-tarball-no-hardlinks.cjs");
    let failed = false;
    try {
      execSync(`node "${verifyScript}" test.tar`, { cwd: root, stdio: "pipe" });
    } catch {
      failed = true;
    }
    assert.ok(failed, "verify-tarball should fail when hard links present");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run() {
  runExpandFixture();
  runPackCandidatesFixture();
  runTarballNameFixture();
  runMaterializeFixture();
  runRemoveStaleFixture();
  runResolveExpectedTgzFixture();
  if (process.platform !== "win32") {
    runRemoveStaleErrorsFixture();
  }
  runTarballHardlinkFixture();
  console.log("publish-pack-files.test: ok");
}

run();
