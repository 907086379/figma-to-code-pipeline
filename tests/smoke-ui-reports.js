"use strict";

function runSmokeUiReports(context) {
  const { assert, fs, os, path, root, runUiAggregate, runUiAutoAcceptance } = context;

  // ui aggregate: should output quality summary json
  {
    const output = runUiAggregate("", root, {});
    const report = JSON.parse(output.trim());
    assert.ok(report.metrics, "aggregate report should include metrics");
    const summaryPath = path.join(root, "figma-cache", "reports", "runtime", "ui-quality-summary.json");
    assert.ok(fs.existsSync(summaryPath), "aggregate report should be written to default path");
  }

  // ui auto acceptance: reports-only should pass with healthy reports
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figma-cache-smoke-auto-accept-"));
    const preflightPath = path.join(tempRoot, "preflight.json");
    const auditPath = path.join(tempRoot, "audit.json");
    const summaryPath = path.join(tempRoot, "summary.json");
    fs.writeFileSync(
      preflightPath,
      JSON.stringify(
        {
          ok: true,
          summary: { blockingCount: 0 },
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    fs.writeFileSync(
      auditPath,
      JSON.stringify(
        {
          ok: true,
          summary: {
            score: { total: 95 },
            warningCount: 0,
            diffCount: 0,
          },
          options: {
            targetPath: "src/components/Example.tsx",
          },
          warnings: [],
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          trend: { status: "healthy" },
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const output = runUiAutoAcceptance(
      `--reports-only --preflight-report=${preflightPath} --audit-report=${auditPath} --summary-report=${summaryPath}`,
      root,
      {}
    );
    const result = JSON.parse(output.trim());
    assert.strictEqual(result.ok, true, "auto acceptance should pass for healthy reports");
  }
}

module.exports = {
  runSmokeUiReports,
};
