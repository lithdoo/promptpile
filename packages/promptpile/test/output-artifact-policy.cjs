'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareOutputArtifactPolicy, resolveMainOutputTargets, resolveOutputArtifactPolicy } = require('../dist/output-artifact-policy.js');
const { CompletionArtifactLedger } = require('../dist/completion-artifact-ledger.js');
const { commitMainOutput } = require('../dist/main-output.js');
const { appendAssistantTurnAtIndex } = require('../dist/file-handler.js');
const { atomicWriteFileSync } = require('../dist/atomic-file.js');
const {
  buildCompletionReceiptHookV1,
  buildCompletionReceiptV1,
  commitCompletionReceiptV1
} = require('../dist/completion-receipt.js');
const { resolveInvocationContext } = require('../dist/invocation-context.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-output-policy-'));
const messages = path.join(root, 'messages');
fs.mkdirSync(messages);
const configFor = (o = {}) => ({
  conversationIo: { inputDirectories: [messages], outputDirectory: o.outputDirectory, anchorDirectory: messages },
  inputDirectories: [messages], directory: messages, outputDirectory: o.outputDirectory,
  model: 'test', apiKey: 'key', apiBaseUrl: 'http://invalid.test', temperature: 0,
  continueMode: o.continueMode ?? false, inputMode: o.inputMode ?? false,
  output: o.output, receipt: o.receipt,
  outputPileTarget: o.outputPileTarget, outputPileFormat: o.outputPileFormat,
  quiet: false, afterHookFailure: 'warn', allowDefaultAfterHook: false, missingToolResults: 'warn'
});
const hookPolicy = resolution => ({ failureMode: 'warn', resolution });

try {
  const targets = resolveMainOutputTargets(root, './run/result.md');
  assert.strictEqual(targets.body.absolutePath, path.join(root, 'run', 'result.md'));
  assert.strictEqual(targets.calls.absolutePath, path.join(root, 'run', 'result.calls.jsonl'));
  assert.strictEqual(targets.extra.absolutePath, path.join(root, 'run', 'result.extra.json'));

  const collisionParent = path.join(root, 'collision-parent');
  assert.throws(() => resolveOutputArtifactPolicy({ cwd: root, config: configFor({
    output: './collision-parent/result.md',
    outputPileTarget: { kind: 'file', path: './collision-parent/result.calls.jsonl', source: 'cli' }
  }), hook: hookPolicy({ status: 'skip', reason: 'not_configured' }) }), /target collision/);
  assert.strictEqual(fs.existsSync(collisionParent), false, 'lexical collision fails before mkdir');

  assert.throws(() => resolveOutputArtifactPolicy({ cwd: root, config: configFor({
    outputDirectory: messages, continueMode: true, output: path.join(messages, '[4]assistant.md')
  }), hook: hookPolicy({ status: 'skip', reason: 'not_configured' }) }), /Conversation namespace/);
  assert.throws(() => resolveOutputArtifactPolicy({ cwd: root, config: configFor({
    outputDirectory: messages,
    outputPileTarget: { kind: 'file', path: path.join(messages, '.promptpile.occ.claim'), source: 'cli' }
  }), hook: hookPolicy({ status: 'skip', reason: 'not_configured' }) }), /reserved Conversation control path/);

  const hookPath = path.join(root, 'hook.sh');
  fs.writeFileSync(hookPath, 'echo ok\n');
  assert.throws(() => resolveOutputArtifactPolicy({ cwd: root,
    config: configFor({ output: hookPath }), hook: hookPolicy({ status: 'run', path: fs.realpathSync(hookPath) })
  }), /overwrite resolved after-hook/);
  assert.strictEqual(fs.readFileSync(hookPath, 'utf8'), 'echo ok\n');
  assert.throws(() => resolveOutputArtifactPolicy({ cwd: root,
    config: configFor({ output: './same.json', receipt: './same.json' }),
    hook: hookPolicy({ status: 'skip', reason: 'not_configured' })
  }), /target collision/);
  assert.throws(() => resolveOutputArtifactPolicy({ cwd: root,
    config: configFor({ receipt: hookPath }),
    hook: hookPolicy({ status: 'run', path: fs.realpathSync(hookPath) })
  }), /overwrite resolved after-hook/);
  assert.throws(() => resolveOutputArtifactPolicy({ cwd: root,
    config: configFor({ outputDirectory: messages, continueMode: true, receipt: path.join(messages, '[5]assistant.md') }),
    hook: hookPolicy({ status: 'skip', reason: 'not_configured' })
  }), /Conversation namespace/);

  const policy = prepareOutputArtifactPolicy(resolveOutputArtifactPolicy({ cwd: root,
    config: configFor({ output: './main/result.md' }), hook: hookPolicy({ status: 'skip', reason: 'not_configured' }) }));
  const ledger = new CompletionArtifactLedger();
  commitMainOutput({ targets: policy.mainOutput, response: 'answer',
    toolCalls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
    reasoningContent: 'reason', ledger });
  assert.deepStrictEqual(ledger.entries().map(ref => [ref.namespace, ref.kind]), [
    ['main', 'body'], ['main', 'calls'], ['main', 'extra']
  ]);
  assert.throws(() => ledger.record({
    namespace: 'main', kind: 'body', absolutePath: path.join(root, 'duplicate.md')
  }), /duplicate completion artifact ledger key/);
  assert.strictEqual(ledger.entries().length, 3, 'duplicate record does not mutate the ledger');

  const bodyFailureTargets = resolveMainOutputTargets(root, './body-failure/result.md');
  fs.mkdirSync(path.dirname(bodyFailureTargets.body.absolutePath), { recursive: true });
  const bodyFailureLedger = new CompletionArtifactLedger();
  let bodyFailureWrites = 0;
  assert.throws(() => commitMainOutput({ targets: bodyFailureTargets, response: 'not written',
    toolCalls: undefined, reasoningContent: undefined, ledger: bodyFailureLedger,
    writeFile() { bodyFailureWrites += 1; throw new Error('injected body failure'); }
  }), /injected body failure/);
  assert.strictEqual(bodyFailureWrites, 1);
  assert.deepStrictEqual(bodyFailureLedger.entries(), []);

  const partialTargets = resolveMainOutputTargets(root, './partial/result.md');
  fs.mkdirSync(path.dirname(partialTargets.body.absolutePath), { recursive: true });
  const partialLedger = new CompletionArtifactLedger();
  let writes = 0;
  assert.throws(() => commitMainOutput({ targets: partialTargets, response: 'kept',
    toolCalls: [{ id: 'c2', type: 'function', function: { name: 'f', arguments: '{}' } }],
    reasoningContent: 'must not be attempted', ledger: partialLedger,
    writeFile(target, content) { writes += 1; if (writes === 2) throw new Error('injected calls failure'); atomicWriteFileSync(target, content); }
  }), /injected calls failure/);
  assert.strictEqual(fs.readFileSync(partialTargets.body.absolutePath, 'utf8'), 'kept');
  assert.deepStrictEqual(partialLedger.entries().map(ref => ref.kind), ['body']);
  assert.strictEqual(writes, 2, 'extra is not attempted after calls failure');

  const extraFailureTargets = resolveMainOutputTargets(root, './extra-failure/result.md');
  fs.mkdirSync(path.dirname(extraFailureTargets.body.absolutePath), { recursive: true });
  const extraFailureLedger = new CompletionArtifactLedger();
  let extraFailureWrites = 0;
  assert.throws(() => commitMainOutput({ targets: extraFailureTargets, response: 'kept body',
    toolCalls: [{ id: 'c-extra', type: 'function', function: { name: 'f', arguments: '{}' } }],
    reasoningContent: 'fails', ledger: extraFailureLedger,
    writeFile(target, content) {
      extraFailureWrites += 1;
      if (extraFailureWrites === 3) throw new Error('injected extra failure');
      atomicWriteFileSync(target, content);
    }
  }), /injected extra failure/);
  assert.strictEqual(extraFailureWrites, 3);
  assert.deepStrictEqual(extraFailureLedger.entries().map(ref => ref.kind), ['body', 'calls']);
  assert.strictEqual(fs.readFileSync(extraFailureTargets.body.absolutePath, 'utf8'), 'kept body');
  assert.ok(fs.existsSync(extraFailureTargets.calls.absolutePath));
  assert.ok(!fs.existsSync(extraFailureTargets.extra.absolutePath));

  const conversationLedger = new CompletionArtifactLedger();
  let conversationWrites = 0;
  assert.throws(() => appendAssistantTurnAtIndex(messages, 10, 'conversation body',
    [{ id: 'c3', type: 'function', function: { name: 'f', arguments: '{}' } }], 'must not be attempted', {
      onArtifactCommitted(artifact) { conversationLedger.record({ namespace: 'conversation', ...artifact }); },
      writeFile(target, content) { conversationWrites += 1; if (conversationWrites === 2) throw new Error('injected conversation calls failure'); atomicWriteFileSync(target, content); }
    }), /injected conversation calls failure/);
  assert.deepStrictEqual(conversationLedger.entries().map(ref => ref.kind), ['body']);
  assert.strictEqual(conversationWrites, 2);

  const emptyTargets = resolveMainOutputTargets(root, './empty/result.md');
  fs.mkdirSync(path.dirname(emptyTargets.body.absolutePath), { recursive: true });
  const emptyLedger = new CompletionArtifactLedger();
  commitMainOutput({ targets: emptyTargets, response: '', toolCalls: undefined, reasoningContent: undefined, ledger: emptyLedger });
  assert.strictEqual(fs.statSync(emptyTargets.body.absolutePath).size, 0);
  assert.deepStrictEqual(emptyLedger.entries().map(ref => ref.kind), ['body']);

  const receiptLedger = new CompletionArtifactLedger();
  const receiptDoc = buildCompletionReceiptV1({
    invocation: resolveInvocationContext('unit-test'), ledger: receiptLedger, model: 'test',
    hook: buildCompletionReceiptHookV1({ status: 'skipped', reason: 'not_configured' }, 'warn')
  });
  assert.deepStrictEqual(receiptDoc.usage, null);
  assert.strictEqual(receiptDoc.finishReason, null);
  const invalidReceiptTarget = path.join(root, 'receipt-target-directory');
  fs.mkdirSync(invalidReceiptTarget);
  assert.throws(() => commitCompletionReceiptV1({
    targetPath: invalidReceiptTarget, receipt: receiptDoc, ledger: receiptLedger
  }));
  assert.strictEqual(receiptLedger.find('receipt', 'receipt'), undefined,
    'a failed atomic publication must not enter the ledger');
  assert.ok(!fs.readdirSync(root).some(name => name.includes('.receipt-target-directory.tmp-')));
  console.log('output artifact policy tests ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
