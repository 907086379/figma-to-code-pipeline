#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { sanitizeDesignContextTextForCache } = require("../scripts/sanitize-design-context-for-cache.cjs");

function run() {
  const code =
    'export function X(){return <div data-node-id="1:2" data-annotations="note A" data-name="Card"/>;}\n';
  const sanitized = sanitizeDesignContextTextForCache(
    `${code}\nSUPER CRITICAL: drop me\n2. x`,
  );
  assert.ok(!/SUPER/i.test(sanitized));
  assert.ok(/data-annotations="note A"/.test(sanitized), "data-annotations in component body must survive sanitize");

  const code2 = "export function X(){return <div/>;}\n";
  assert.ok(
    !/SUPER/i.test(sanitizeDesignContextTextForCache(`${code2}\nSUPER CRITICAL: drop me\n2. x`)),
  );
  assert.ok(
    !/SUPER/i.test(sanitizeDesignContextTextForCache(`${code2}\n**SUPER CRITICAL:** drop me`)),
  );
  assert.ok(
    !/SUPER/i.test(sanitizeDesignContextTextForCache(`}\n\nSUPER CRITICAL:\nThese styles are contained in the design: x`)),
  );
  console.log("sanitize-design-context-for-cache.test: ok");
}

run();
