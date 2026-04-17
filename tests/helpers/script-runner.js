"use strict";

const { execSync } = require("child_process");

function runNodeScript(scriptPath, args, cwd, extraEnv) {
  const cliArgs = args ? ` ${args}` : "";
  return execSync(`node "${scriptPath}"${cliArgs}`, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(extraEnv || {}),
    },
  });
}

module.exports = {
  runNodeScript,
};
