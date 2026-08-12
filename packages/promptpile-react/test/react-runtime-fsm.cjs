'use strict';

const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const { PromptpileReactRuntime } = require(path.join(root, 'dist', 'react-runtime.js'));

const config = maxStep => ({
  cwd: process.cwd(),
  inputDirectoriesAbs: [],
  directoryAbs: process.cwd(),
  quiet: true,
  inputMode: false,
  continueMode: false,
  maxStep,
  phases: { thought: {}, observe: {}, check: {}, final: {} },
  prompts: { core: '', observe: '', check: '', final: '' }
});

const makeRuntime = ({ maxStep = 1, decisions = [false], failAt } = {}) => {
  const runtime = new PromptpileReactRuntime(config(maxStep), {
    command: process.execPath,
    argvPrefix: [],
    displayName: 'unused'
  });
  const calls = [];
  let decisionIndex = 0;
  runtime.reactThoughtProcess = async () => {
    calls.push('thought');
    if (failAt === 'thought') throw new Error('thought failed');
  };
  runtime.reactObserveProcess = async () => {
    calls.push('observe');
    if (failAt === 'observe') throw new Error('observe failed');
    return 'observation';
  };
  runtime.reactCheckProcess = async () => {
    calls.push('check');
    if (failAt === 'check') throw new Error('check failed');
    return decisions[decisionIndex++] ?? false;
  };
  runtime.reactFinalAnswerProcess = async () => {
    calls.push('final');
    if (failAt === 'final') throw new Error('final failed');
  };
  return { runtime, calls };
};

const runSession = async runtime => {
  while (runtime.stopReason === 'running') {
    await runtime.nextStep();
  }
  await runtime.finalAnswer();
};

(async () => {
  {
    const { runtime, calls } = makeRuntime();
    await runSession(runtime);
    assert.strictEqual(runtime.currentStep, 1);
    assert.strictEqual(runtime.stopReason, 'final');
    assert.deepStrictEqual(calls, ['thought', 'observe', 'check', 'final']);
  }

  {
    const { runtime, calls } = makeRuntime({ decisions: [true] });
    await runSession(runtime);
    assert.strictEqual(runtime.currentStep, 1);
    assert.strictEqual(runtime.stopReason, 'max_step');
    assert.deepStrictEqual(calls, ['thought', 'observe', 'check', 'final']);
  }

  {
    const { runtime, calls } = makeRuntime({ maxStep: 3, decisions: [true, true, true] });
    await runSession(runtime);
    assert.strictEqual(runtime.currentStep, 3);
    assert.strictEqual(runtime.stopReason, 'max_step');
    assert.strictEqual(calls.filter(call => call === 'thought').length, 3);
  }

  for (const phase of ['thought', 'observe', 'check']) {
    const { runtime, calls } = makeRuntime({ failAt: phase });
    await runSession(runtime);
    assert.strictEqual(runtime.currentStep, 0, `${phase} failure must not complete a step`);
    assert.strictEqual(runtime.stopReason, 'error');
    assert.ok(!calls.includes('final'), `${phase} failure must not invoke Final`);
  }

  {
    const { runtime } = makeRuntime({ failAt: 'final' });
    await runSession(runtime);
    assert.strictEqual(runtime.stopReason, 'error');
  }

  {
    const { runtime, calls } = makeRuntime();
    runtime.stopReason = 'error';
    await runtime.finalAnswer();
    assert.deepStrictEqual(calls, []);
  }

  console.log('promptpile-react FSM tests ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
