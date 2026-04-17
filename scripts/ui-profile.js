"use strict";

const DEFAULT_UI_PROFILE = "standard";

const PROFILE_CONFIG = Object.freeze({
  fast: Object.freeze({
    preflightTreatWarningsAsBlocking: false,
    auditDefaultMinScore: 70,
    auditRequireTargetPath: false,
  }),
  standard: Object.freeze({
    preflightTreatWarningsAsBlocking: false,
    auditDefaultMinScore: 85,
    auditRequireTargetPath: false,
  }),
  strict: Object.freeze({
    preflightTreatWarningsAsBlocking: true,
    auditDefaultMinScore: 92,
    auditRequireTargetPath: true,
  }),
});

function resolveUiProfile(input) {
  const raw = String(input || process.env.FIGMA_UI_PROFILE || DEFAULT_UI_PROFILE)
    .trim()
    .toLowerCase();
  if (raw && PROFILE_CONFIG[raw]) {
    return raw;
  }
  return DEFAULT_UI_PROFILE;
}

function getUiProfileConfig(input) {
  const profile = resolveUiProfile(input);
  return {
    profile,
    ...PROFILE_CONFIG[profile],
  };
}

module.exports = {
  DEFAULT_UI_PROFILE,
  PROFILE_CONFIG,
  resolveUiProfile,
  getUiProfileConfig,
};
