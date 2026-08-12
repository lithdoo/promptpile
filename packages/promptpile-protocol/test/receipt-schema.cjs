'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const normative = fs.readFileSync(path.join(__dirname, '../../../doc/15-contracts/completion-receipt-v1.schema.json'));
const published = fs.readFileSync(path.join(__dirname, '../dist/schemas/completion-receipt-v1.json'));
assert.deepStrictEqual(published, normative);
assert.deepStrictEqual(require('promptpile-protocol/schemas/completion-receipt-v1.json'), JSON.parse(normative));
