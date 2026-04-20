# Release Notes - 2.0.4

Release date: 2026-04-17

## Highlights

- Added UI gate toolchain commands: `fc:ui:preflight`, `fc:ui:audit`, `fc:ui:report:aggregate`, `fc:ui:accept`, and cross-project `fc:ui:e2e:cross`.
- Added `ui-facts-normalizer` and top-10 component recipes to improve generic audit quality while keeping recipe matching optional.
- Upgraded contract checks with `layoutRules` / `typographyRules` / `interactionRules` and node-level `ui-override` conflict detection.
- Added fast/strict execution templates and baseline report artifacts for early-phase quality tracking.

## Validation

- `npm test` passed
- `npm pack --dry-run` passed

## Upgrade Notes

- For cross-project acceptance, ensure target project can resolve installed package scripts:
  - `npm run fc:ui:e2e:cross -- --target-project=<path> --cacheKey=<fileKey#nodeId> --target=<componentPath>`
- Optional resilience flags:
  - `--auto-ensure-on-miss`
  - `--fix-loop=<N>`
