'use strict';

const assert = require('assert');
const path = require('path');

const packageRoot = path.join(__dirname, '..');
const {
  parseInvocationId,
  resolveInvocationContext
} = require(path.join(packageRoot, 'dist', 'invocation-context.js'));

assert.strictEqual(parseInvocationId(undefined), undefined);
assert.strictEqual(parseInvocationId('a'), 'a');
assert.strictEqual(parseInvocationId('run:01J.X_Y-Z'), 'run:01J.X_Y-Z');
assert.strictEqual(parseInvocationId('x'.repeat(128)), 'x'.repeat(128));
assert.deepStrictEqual(resolveInvocationContext(undefined), { id: null });
assert.deepStrictEqual(resolveInvocationContext('run:resolved'), { id: 'run:resolved' });

const invalidValues = [
  null, 1, {}, [], '', 'x'.repeat(129), ' has-space', 'has-space ',
  'has space', '../escape', 'a\\b', '换行', 'a\nb'
];
for (const invalid of invalidValues) {
  assert.throws(
    () => parseInvocationId(invalid),
    error => error instanceof Error &&
      error.message === 'invalid invocation id: expected 1-128 characters matching [A-Za-z0-9._:-]'
  );
}

console.log('invocation-context.cjs: ok');
