'use strict';

const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const { parseExtraBodyInput, coerceExtraBodyValue } = require(path.join(
  root,
  'dist',
  'llm-extra-body.js'
));

assert.strictEqual(parseExtraBodyInput(undefined), undefined);
assert.strictEqual(parseExtraBodyInput(''), undefined);
assert.strictEqual(parseExtraBodyInput('  '), undefined);
assert.deepStrictEqual(parseExtraBodyInput('{"top_p":0.9}'), { top_p: 0.9 });

assert.throws(() => parseExtraBodyInput('not-json'), /Invalid extra_body JSON/);
assert.throws(() => parseExtraBodyInput('[]'), /must be a JSON object/);
assert.throws(() => parseExtraBodyInput('null'), /must be a JSON object/);

assert.deepStrictEqual(coerceExtraBodyValue({ a: 1 }), { a: 1 });
assert.deepStrictEqual(coerceExtraBodyValue('{"b":2}'), { b: 2 });
assert.strictEqual(coerceExtraBodyValue(undefined), undefined);
assert.throws(() => coerceExtraBodyValue(42), /must be a TOML table/);

console.log('llm-extra-body tests ok');
