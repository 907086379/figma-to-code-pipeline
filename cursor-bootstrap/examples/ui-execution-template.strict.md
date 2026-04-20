# UI 执行模板（strict）

适用：主干发布、关键路径页面、高保真验收。

1. `npm run fc:ui:preflight`
2. `npm run fc:ui:audit -- --target=<component-path> --min-score=92`
3. `npm run fc:ui:report:aggregate`
4. `npm run fc:ui:gate:main`

建议：
- `FIGMA_UI_PROFILE=strict`
- preflight warning 视为阻断
- audit 必须提供 `--target`
