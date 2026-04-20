# UI 执行模板（fast）

适用：只需快速看效果、先跑通路径。

1. `npm run fc:ui:preflight`
2. `npm run fc:ui:audit -- --min-score=70`
3. 允许 warning，但记录差异项并进入下一轮迭代

建议：
- `FIGMA_UI_PROFILE=fast`
- 仅用于原型验证，不用于主干发布门禁
