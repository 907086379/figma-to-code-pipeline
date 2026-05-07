#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { sanitizeDesignContextTextForCache } = require("../scripts/sanitize-design-context-for-cache.cjs");

function run() {
  const code = "export function X(){return <div/>;}\n";
  assert.ok(
    !/SUPER/i.test(sanitizeDesignContextTextForCache(`${code}\nSUPER CRITICAL: drop me\n2. x`)),
  );
  assert.ok(
    !/SUPER/i.test(sanitizeDesignContextTextForCache(`${code}\n**SUPER CRITICAL:** drop me`)),
  );
  assert.ok(
    !/SUPER/i.test(sanitizeDesignContextTextForCache(`}\n\nSUPER CRITICAL:\nThese styles are contained in the design: x`)),
  );
  console.log("sanitize-design-context-for-cache.test: ok");
}

run();
