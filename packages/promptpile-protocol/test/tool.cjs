'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('../dist/tool.js');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../fixtures/tool-artifacts-v1/cases.json'), 'utf8'));
for (const item of cases.calls) {
  const before = JSON.stringify(item.value);
  assert.strictEqual(protocol.parseToolCallV1(item.value) !== undefined, item.valid);
  assert.strictEqual(JSON.stringify(item.value), before);
}
for (const item of cases.results) {
  const before = JSON.stringify(item.value);
  assert.strictEqual(protocol.parseToolResultLineV1(item.value) !== undefined, item.valid);
  assert.strictEqual(JSON.stringify(item.value), before);
}
