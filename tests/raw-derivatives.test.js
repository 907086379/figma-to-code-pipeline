"use strict";

const assert = require("assert");
const {
  mergeLayoutMetricsFromGeometry,
  buildEvidenceSummary,
  extractFigmaDataAnnotationsFromDesignContext,
} = require("../figma-cache/js/raw-derivatives");

{
  const raw = { layoutMetrics: [{ id: "a", v: 1 }] };
  mergeLayoutMetricsFromGeometry(raw, { metrics: [{ id: "a", v: 2 }, { id: "b", v: 3 }] });
  assert.strictEqual(raw.layoutMetrics.length, 2);
  const byId = Object.fromEntries(raw.layoutMetrics.map((m) => [m.id, m]));
  assert.strictEqual(byId.a.v, 2);
  assert.strictEqual(byId.b.v, 3);
}

{
  const dc = `${'<div data-node-id="9:1"></div>'.repeat(10)}\nconst imgX = "https://www.figma.com/api/mcp/asset/cccccccc-cccc-cccc-cccc-cccccccccccc";\n<img src={imgX} />`;
  const s = buildEvidenceSummary({
    designContextText: dc,
    metadataText: "<instance/>",
    variableDefs: { a: 1, b: 2 },
    nodeId: "9:1",
    geometryFilePresent: true,
    iconMetricsCount: 3,
    layoutMetricsCount: 4,
    figmaDataAnnotationCount: 5,
  });
  assert.strictEqual(s.version, 1);
  assert.ok(s.generatedAt);
  assert.ok(s.dataNodeIdRefs >= 10);
  assert.strictEqual(s.dataNodeIdContainsScope, true);
  assert.ok(s.designContextImgConstDefinitions >= 1);
  assert.ok(s.imgTagOccurrences >= 1);
  assert.strictEqual(s.variableDefKeys, 2);
  assert.strictEqual(s.geometryFilePresent, true);
  assert.strictEqual(s.iconMetricsCount, 3);
  assert.strictEqual(s.layoutMetricsCount, 4);
  assert.strictEqual(s.figmaDataAnnotationCount, 5);
}

{
  const dc =
    '<div data-node-id="11038:687" data-annotations="这是为了测试所加的annotation" data-name="Card" class="x">';
  const ann = extractFigmaDataAnnotationsFromDesignContext(dc);
  assert.strictEqual(ann.schemaVersion, 1);
  assert.strictEqual(ann.items.length, 1);
  assert.strictEqual(ann.items[0].nodeId, "11038:687");
  assert.strictEqual(ann.items[0].name, "Card");
  assert.strictEqual(ann.items[0].text, "这是为了测试所加的annotation");
}

{
  const dc = '<div data-annotations="line\\n2" data-node-id="9:1" />';
  const ann = extractFigmaDataAnnotationsFromDesignContext(dc);
  assert.strictEqual(ann.items[0].text, "line\n2");
}

{
  const dc =
    "<div data-node-id='11038:687' data-annotations='单引号属性' data-name='卡片' class=\"x\">";
  const ann = extractFigmaDataAnnotationsFromDesignContext(dc);
  assert.strictEqual(ann.items.length, 1);
  assert.strictEqual(ann.items[0].nodeId, "11038:687");
  assert.strictEqual(ann.items[0].name, "卡片");
  assert.strictEqual(ann.items[0].text, "单引号属性");
}

{
  const dc = '<div data-node-id="99:88" data-name="Line\\nName" data-annotations="x" />';
  const ann = extractFigmaDataAnnotationsFromDesignContext(dc);
  assert.strictEqual(ann.items[0].nodeId, "99:88");
  assert.strictEqual(ann.items[0].name, "Line\nName");
}

console.log("raw-derivatives.test: ok");
