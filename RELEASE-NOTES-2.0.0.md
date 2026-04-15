# Release Notes - 2.0.0

Release date: 2026-04-15

## Highlights

- Breaking change: `figma-cache cursor init` now overwrites same-name `.cursor` rule/skill templates by default to keep projects aligned with latest bootstrap updates.
- New global token-saving rule: `00-output-token-budget.mdc` is now distributed automatically to project `.cursor/rules/`.
- Stronger MCP evidence safety: enforced anti-truncation checks after `mcp-raw` writes with explicit reporting (`mcp-raw anti-truncation: pass|fail`).
- UI implementation flow is now explicit: UI/component restoration must read full `mcp-raw-get-design-context.txt`; non-UI tasks default to lightweight cache artifacts.
- Docs and setup prompts are synchronized to the above behavior for predictable team adoption.

## Breaking Change Details

- `figma-cache cursor init` behavior changed:
  - Default: overwrite existing bootstrap templates in `.cursor/rules/` and `.cursor/skills/`.
  - `--force`: keep existing local templates and skip overwrite.

## Included Improvements

- Added bootstrap rule: `.cursor/rules/00-output-token-budget.mdc`.
- Updated bootstrap and local rules/skills:
  - `01-figma-cache-core.mdc`
  - `figma-mcp-local-cache/SKILL.md`
- Updated setup prompts:
  - `AGENT-SETUP-PROMPT.md`
  - `cursor-bootstrap/AGENT-SETUP-PROMPT.md`
- Updated docs:
  - `README.md`
  - `figma-cache/docs/README.md`
  - `CHANGELOG.md`

## Validation

- `npm run docs:encoding:check` passed
- `npm test` passed

## Upgrade Notes

- If your project intentionally customizes `.cursor` rules/skills, run:
  - `npx figma-cache cursor init --force`
  to preserve local templates.
- For teams that want latest default behavior, run:
  - `npx figma-cache cursor init`
