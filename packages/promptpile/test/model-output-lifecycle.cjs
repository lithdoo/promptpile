'use strict';
const assert = require('assert');
const { runModelOutputLifecycle } = require('../dist/model-output-lifecycle.js');
const { secondaryFailuresOf } = require('../dist/primary-failure.js');

(async () => {
  const modelFailure = new Error('injected model failure');
  const closeFailure = new Error('injected pile close failure');
  let modelCalls = 0;
  let errorWrites = 0;
  let doneWrites = 0;
  let observed;
  try {
    await runModelOutputLifecycle({
      outputPile: {
        ready: async () => undefined,
        writeDelta: () => undefined,
        writeDone: () => { doneWrites += 1; },
        writeError: error => { assert.strictEqual(error, modelFailure); errorWrites += 1; },
        close: async () => { throw closeFailure; }
      },
      runModel: async () => { modelCalls += 1; throw modelFailure; }
    });
  } catch (error) {
    observed = error;
  }
  assert.strictEqual(observed, modelFailure, 'pile close failure must not replace model failure');
  assert.strictEqual(modelCalls, 1);
  assert.strictEqual(errorWrites, 1);
  assert.strictEqual(doneWrites, 0);
  assert.deepStrictEqual(secondaryFailuresOf(observed), [closeFailure]);

  const onlyCloseFailure = new Error('close is primary after model success');
  await assert.rejects(
    runModelOutputLifecycle({
      outputPile: {
        ready: async () => undefined,
        writeDelta: () => undefined,
        writeDone: () => undefined,
        writeError: () => undefined,
        close: async () => { throw onlyCloseFailure; }
      },
      runModel: async () => 'result'
    }),
    error => error === onlyCloseFailure
  );

  console.log('model output lifecycle tests ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
