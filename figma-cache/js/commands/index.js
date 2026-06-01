const handleCursor = require("./cursor");
const handleNormalize = require("./normalize");
const handleGet = require("./get");
const handleUpsert = require("./upsert");
const handleEnsure = require("./ensure");
const handleEnrich = require("./enrich");
const handleValidate = require("./validate");
const handleContractCheck = require("./contract-check");
const handleStale = require("./stale");
const handleBackfill = require("./backfill");
const handleBudget = require("./budget");
const handleConfig = require("./config");
const handleInit = require("./init");
const handleFlow = require("./flow");
const handleProjectSetup = require("./project-setup");

const COMMAND_HANDLERS = Object.freeze({
  cursor: handleCursor,
  normalize: handleNormalize,
  get: handleGet,
  upsert: handleUpsert,
  ensure: handleEnsure,
  enrich: handleEnrich,
  validate: handleValidate,
  "contract-check": handleContractCheck,
  stale: handleStale,
  backfill: handleBackfill,
  budget: handleBudget,
  config: handleConfig,
  init: handleInit,
  flow: handleFlow,
  "project-setup": handleProjectSetup,
});

function createCommandRegistry(context) {
  const registry = new Map();
  Object.entries(COMMAND_HANDLERS).forEach(([name, handler]) => {
    registry.set(name, (args) => handler(args, context));
  });
  return registry;
}

module.exports = {
  createCommandRegistry,
};
