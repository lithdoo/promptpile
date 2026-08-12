'use strict';

const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  parseExtraBodyInput,
  coerceExtraBodyValue,
  RESERVED_CHAT_COMPLETION_REQUEST_KEYS
} = require(path.join(
  root,
  'dist',
  'llm-extra-body.js'
));

assert.strictEqual(parseExtraBodyInput(undefined), undefined);
assert.strictEqual(parseExtraBodyInput(''), undefined);
assert.strictEqual(parseExtraBodyInput('  '), undefined);
assert.deepStrictEqual(parseExtraBodyInput('{"top_p":0.9}'), { top_p: 0.9 });
assert.deepStrictEqual(parseExtraBodyInput('{"nested":{"enabled":true}}'), {
  nested: { enabled: true }
});

assert.throws(() => parseExtraBodyInput('not-json'), /Invalid extra_body JSON/);
assert.throws(() => parseExtraBodyInput('[]'), /must be a JSON object/);
assert.throws(() => parseExtraBodyInput('null'), /must be a JSON object/);
assert.throws(() => parseExtraBodyInput('"text"'), /must be a JSON object/);

assert.deepStrictEqual(coerceExtraBodyValue({ a: 1 }), { a: 1 });
assert.throws(() => coerceExtraBodyValue('{"b":2}'), /must be a TOML table/);
assert.strictEqual(coerceExtraBodyValue(undefined), undefined);
assert.throws(() => coerceExtraBodyValue(42), /must be a TOML table/);
assert.throws(() => coerceExtraBodyValue([]), /must be a TOML table/);

for (const key of RESERVED_CHAT_COMPLETION_REQUEST_KEYS) {
  assert.throws(
    () => parseExtraBodyInput(JSON.stringify({ [key]: 'override' })),
    new RegExp(`reserved request field: ${key}$`),
    `CLI extra_body must reject ${key}`
  );
  assert.throws(
    () => coerceExtraBodyValue({ [key]: 'override' }),
    new RegExp(`reserved request field: ${key}$`),
    `TOML/profile extra_body must reject ${key}`
  );
}

console.log('llm-extra-body tests ok');
