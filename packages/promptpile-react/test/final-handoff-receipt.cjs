'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  buildFinalObservationHandoff,
  writeFinalObservationHandoff
} = require(path.join(root, 'dist', 'final-observation-handoff.js'));
const { validateFinalReceipt } = require(path.join(root, 'dist', 'final-receipt.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-final-artifacts-'));
const work = path.join(tmp, 'work');
const output = path.join(tmp, 'output');
fs.mkdirSync(work);
fs.mkdirSync(output);
const session = { sessionId: 'receipt-session', workRootAbs: tmp, workDirectoryAbs: work };

try {
  const body = buildFinalObservationHandoff({
    observation: { stepIndex: 2, text: 'latest observation' },
    stopReason: 'max_step'
  });
  assert.match(body, /iteration="2"/);
  assert.match(body, /latest observation/);
  assert.doesNotMatch(body, /older observation/);
  assert.throws(
    () => buildFinalObservationHandoff({
      observation: { stepIndex: 0, text: '  ' },
      stopReason: 'final'
    }),
    /empty Observe/
  );
  const handoffPath = writeFinalObservationHandoff({
    session,
    observation: { stepIndex: 2, text: 'latest observation' },
    stopReason: 'final'
  });
  assert.strictEqual(path.basename(handoffPath), 'final-handoff.user.md');

  const assistant = path.join(output, '[0]assistant.md');
  fs.writeFileSync(assistant, 'final');
  const receiptPath = path.join(work, 'receipt.json');
  const receipt = {
    schemaVersion: 1,
    status: 'completed',
    invocationId: 'receipt-session-final',
    artifacts: {
      assistant,
      calls: null,
      extra: null,
      mainOutput: null,
      mainCalls: null,
      mainExtra: null
    }
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  validateFinalReceipt({
    receiptPath,
    expectedInvocationId: 'receipt-session-final',
    userWritableAbs: output
  });

  const receiptWithoutCalls = JSON.parse(JSON.stringify(receipt));
  delete receiptWithoutCalls.artifacts.calls;
  fs.writeFileSync(receiptPath, JSON.stringify(receiptWithoutCalls));
  assert.throws(
    () => validateFinalReceipt({
      receiptPath,
      expectedInvocationId: 'receipt-session-final',
      userWritableAbs: output
    }),
    /field is missing: calls/
  );
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));

  assert.throws(
    () => validateFinalReceipt({
      receiptPath,
      expectedInvocationId: 'wrong-final',
      userWritableAbs: output
    }),
    /invocationId/
  );

  const outside = path.join(tmp, 'outside.md');
  fs.writeFileSync(outside, 'outside');
  receipt.artifacts.assistant = outside;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(
    () => validateFinalReceipt({
      receiptPath,
      expectedInvocationId: 'receipt-session-final',
      userWritableAbs: output
    }),
    /outside/
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('promptpile-react Final handoff and Receipt tests ok');
