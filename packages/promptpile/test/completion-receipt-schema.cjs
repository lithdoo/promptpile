'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;

const packageRoot = path.join(__dirname, '..');
const publishedSchema = JSON.parse(fs.readFileSync(
  path.join(packageRoot, 'dist', 'completion-receipt-v1.schema.json'),
  'utf8'
));
const contractSchema = JSON.parse(fs.readFileSync(
  path.join(packageRoot, '..', '..', 'doc', '15-contracts', 'completion-receipt-v1.schema.json'),
  'utf8'
));

assert.deepStrictEqual(
  publishedSchema,
  contractSchema,
  'the npm package schema copy must match the normative contract'
);

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(contractSchema);
const receiptWithHook = hook => ({
  schemaVersion: 1,
  status: 'completed',
  invocationId: 'schema-contract-run',
  artifacts: {
    assistant: null,
    calls: null,
    extra: null,
    mainOutput: 'C:\\run\\answer.md',
    mainCalls: null,
    mainExtra: null
  },
  model: 'requested-model',
  finishReason: null,
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  hook
});

const assertValid = (value, message) => {
  assert.strictEqual(validate(value), true, `${message}: ${JSON.stringify(validate.errors)}`);
};
const assertInvalid = (value, message) => {
  assert.strictEqual(validate(value), false, message);
};

for (const failureMode of ['warn', 'error']) {
  assertValid(receiptWithHook({
    status: 'skipped', failureMode, reason: 'not_configured'
  }), `skipped + ${failureMode} must remain valid`);
  assertValid(receiptWithHook({
    status: 'succeeded', failureMode, path: '/run/hook.sh', exitCode: 0
  }), `succeeded + ${failureMode} must remain valid`);
}

const failedHooks = [
  { status: 'invalid_explicit', attempted: '/run/missing.sh', reason: 'not_found' },
  { status: 'spawn_failed', path: '/run/hook.sh', errorCode: 'ENOENT' },
  { status: 'exited_nonzero', path: '/run/hook.sh', exitCode: 7 },
  { status: 'signaled', path: '/run/hook.sh', signal: 'SIGTERM' }
];

for (const hook of failedHooks) {
  assertValid(receiptWithHook({ ...hook, failureMode: 'warn' }),
    `${hook.status} + warn must be valid`);
  assertInvalid(receiptWithHook({ ...hook, failureMode: 'error' }),
    `${hook.status} + error must be rejected from a completed receipt`);
}

assertInvalid(receiptWithHook({
  status: 'exited_nonzero', failureMode: 'warn', path: '/run/hook.sh', exitCode: 0
}), 'exited_nonzero must reject exit code zero');

const withAdditionalProperty = receiptWithHook({
  status: 'skipped', failureMode: 'warn', reason: 'not_configured'
});
withAdditionalProperty.unexpected = true;
assertInvalid(withAdditionalProperty, 'top-level additional properties must be rejected');

const withInvalidInvocationId = receiptWithHook({
  status: 'skipped', failureMode: 'warn', reason: 'not_configured'
});
withInvalidInvocationId.invocationId = '../escape';
assertInvalid(withInvalidInvocationId, 'invalid invocation IDs must be rejected');

const withInvalidUsage = receiptWithHook({
  status: 'skipped', failureMode: 'warn', reason: 'not_configured'
});
withInvalidUsage.usage.inputTokens = -1;
assertInvalid(withInvalidUsage, 'negative usage must be rejected');

const {
  buildCompletionReceiptHookV1,
  buildCompletionReceiptV1
} = require('../dist/completion-receipt.js');
const { CompletionArtifactLedger } = require('../dist/completion-artifact-ledger.js');

const ledger = new CompletionArtifactLedger();
ledger.record({ namespace: 'main', kind: 'body', absolutePath: 'C:\\run\\answer.md' });
const produced = buildCompletionReceiptV1({
  invocation: { id: 'producer-run' },
  ledger,
  model: 'requested-model',
  hook: buildCompletionReceiptHookV1({ status: 'skipped', reason: 'not_configured' }, 'error')
});
assertValid(produced, 'the current producer must emit a schema-valid receipt');

assert.throws(
  () => buildCompletionReceiptHookV1({
    status: 'exited_nonzero',
    path: '/run/hook.sh',
    exitCode: 7,
    stderrTail: '',
    stderrTruncated: false
  }, 'error'),
  /cannot build a completed receipt from a fatal after-hook decision/
);

console.log('completion-receipt-schema.cjs: ok');
