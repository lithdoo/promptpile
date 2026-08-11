'use strict';
const assert = require('assert');
const {
  AfterHookFailureError,
  evaluateAfterHookPolicy,
  formatAfterHookDiagnostic,
  observeAfterHookResolution,
  parseAfterHookFailureMode
} = require('../dist/after-hook-policy.js');

assert.strictEqual(parseAfterHookFailureMode(undefined), undefined);
assert.strictEqual(parseAfterHookFailureMode(''), undefined);
assert.strictEqual(parseAfterHookFailureMode(' warn '), 'warn');
assert.strictEqual(parseAfterHookFailureMode('error'), 'error');
assert.throws(() => parseAfterHookFailureMode(' WARN '), /invalid after-hook failure mode/);
assert.throws(() => parseAfterHookFailureMode('ignore'), /invalid after-hook failure mode/);
assert.throws(() => parseAfterHookFailureMode(1), /must be warn or error/);

const skipped = observeAfterHookResolution({ status: 'skip', reason: 'default_not_found' });
assert.deepStrictEqual(skipped, { status: 'skipped', reason: 'default_not_found' });
assert.strictEqual(observeAfterHookResolution({ status: 'run', path: '/hook' }), undefined);
const invalid = observeAfterHookResolution({
  status: 'invalid_explicit', attempted: '/missing', reason: 'ENOENT'
});
assert.deepStrictEqual(evaluateAfterHookPolicy(skipped, 'error').impact, 'none');
assert.deepStrictEqual(evaluateAfterHookPolicy({
  status: 'succeeded', path: '/hook', exitCode: 0
}, 'error').impact, 'none');
assert.deepStrictEqual(evaluateAfterHookPolicy(invalid, 'warn').impact, 'warning');
assert.deepStrictEqual(evaluateAfterHookPolicy(invalid, 'error').impact, 'error');

for (const observation of [
  { status: 'spawn_failed', path: '/hook', message: 'ENOENT' },
  { status: 'exited_nonzero', path: '/hook', exitCode: 7, stderrTail: 'bad', stderrTruncated: false },
  { status: 'signaled', path: '/hook', signal: 'SIGTERM', stderrTail: '', stderrTruncated: false }
]) {
  assert.strictEqual(evaluateAfterHookPolicy(observation, 'warn').impact, 'warning');
  assert.strictEqual(evaluateAfterHookPolicy(observation, 'error').impact, 'error');
}

const diagnostic = formatAfterHookDiagnostic({
  status: 'exited_nonzero', path: '/hook', exitCode: 7,
  stderrTail: 'tail\n', stderrTruncated: true
});
assert.match(diagnostic, /code 7/);
assert.match(diagnostic, /tail/);
assert.match(diagnostic, /truncated/);
const failure = new AfterHookFailureError(invalid);
assert.strictEqual(failure.name, 'AfterHookFailureError');
assert.strictEqual(failure.observation, invalid);
assert.ok(!JSON.stringify(failure.observation).includes('process.env'));

console.log('after-hook policy tests ok');
