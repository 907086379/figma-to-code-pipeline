# Release Notes - 2.0.3

Release date: 2026-04-16

## Highlights

- `cursor init` now uses safe default behavior (keep existing templates) with explicit `--overwrite` mode for replacement.
- Legacy `--force` is preserved for backward compatibility and maps to keep-existing behavior.
- Shadow governance is now source-of-truth driven by `cursor-bootstrap/managed-files.json`, including retired-file cleanup and drift detection.
- UI governance is simplified: merged 03 rules, reduced duplicate skills, and unified local rules naming to `local-*`.

## Validation

- `npm run verify:cursor:sync` passed
- `npm run verify:cursor` passed
- `npm test` passed

## Upgrade Notes

- Keep local custom templates (default):
  - `npx figma-cache cursor init`
- Force replace with latest bootstrap templates:
  - `npx figma-cache cursor init --overwrite`
- Use `--force` only for legacy scripts expecting keep-existing behavior.
