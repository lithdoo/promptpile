'use strict';

const assert = require('assert');

const root = require('path').join(__dirname, '..');
const {
  DEFAULT_TEMPERATURE,
  parseTemperatureInput,
  coerceTemperatureValue
} = require(require('path').join(root, 'dist', 'llm-sampling.js'));

assert.strictEqual(DEFAULT_TEMPERATURE, 0.8);
assert.strictEqual(parseTemperatureInput(undefined), undefined);
assert.strictEqual(parseTemperatureInput(''), undefined);
assert.strictEqual(parseTemperatureInput('  '), undefined);
assert.strictEqual(parseTemperatureInput('0.7'), 0.7);
assert.strictEqual(coerceTemperatureValue(0.3), 0.3);

assert.throws(() => parseTemperatureInput('abc'), /Invalid temperature/);
assert.throws(() => parseTemperatureInput('3'), /between 0 and 2/);
assert.throws(() => coerceTemperatureValue(-0.1), /between 0 and 2/);

console.log('llm-sampling tests ok');
