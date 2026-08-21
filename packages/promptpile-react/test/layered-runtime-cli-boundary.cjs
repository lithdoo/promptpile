'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { PromptpileReactRuntime } = require(path.join(root, 'dist', 'react-runtime.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-layered-runtime-'));
const base = path.join(tmp, 'base');
const shared = path.join(tmp, 'shared');
const output = path.join(tmp, 'session');
const work = path.join(tmp, 'work');
const fakeCli = path.join(tmp, 'fake-promptpile.cjs');
const callsLog = path.join(tmp, 'calls.jsonl');
const statePath = path.join(tmp, 'state.json');
const previousLog = process.env.PPR_LAYERED_CALLS_LOG;
const previousState = process.env.PPR_LAYERED_STATE;

for (const directory of [base, shared, output, work]) fs.mkdirSync(directory);
fs.writeFileSync(path.join(base, '[0]system.md'), 'base');
fs.writeFileSync(path.join(shared, '[0]user.md'), 'shared');
fs.writeFileSync(statePath, JSON.stringify({ thought: 0, check: 0 }));
fs.writeFileSync(
  fakeCli,
  [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    'const state = JSON.parse(fs.readFileSync(process.env.PPR_LAYERED_STATE, "utf8"));',
    'fs.appendFileSync(process.env.PPR_LAYERED_CALLS_LOG, JSON.stringify(argv) + "\\n");',
    'const outputIndex = argv.indexOf("--output-dir");',
    'const mainOutputIndex = argv.indexOf("-o");',
    'const isCheck = argv.includes("--tool-choice");',
    'const isObserve = mainOutputIndex >= 0 && argv.includes("--append-files");',
    'const isThought = mainOutputIndex < 0 && !argv.includes("--disable-tool");',
    'const isFinal = mainOutputIndex < 0 && argv.includes("--disable-tool") && !isCheck;',
    'if (isThought) {',
    '  const session = argv[outputIndex + 1];',
    '  const index = state.thought++;',
    '  fs.writeFileSync(path.join(session, `[${index}]assistant.calls.jsonl`), "call\\n");',
    '  fs.writeFileSync(path.join(session, `[${index}]assistant.result.jsonl`), "result\\n");',
    '}',
    'if (isObserve) fs.writeFileSync(argv[mainOutputIndex + 1], "observe report");',
    'if (isCheck) {',
    '  const destination = argv[mainOutputIndex + 1];',
    '  fs.writeFileSync(destination, "check output");',
    '  const parsed = path.parse(destination);',
    '  const calls = path.join(parsed.dir, `${parsed.name}.calls.jsonl`);',
    '  const decision = state.check++ === 0;',
    '  const call = { id: `call-${state.check}`, type: "function", function: { name: "react_check_decision", arguments: JSON.stringify({ decision }) } };',
    '  fs.writeFileSync(calls, JSON.stringify(call) + "\\n");',
    '}',
    'if (isFinal && argv.includes("-c")) {',
    '  const directory = argv[outputIndex + 1];',
    '  const assistant = path.join(directory, "[0]assistant.md");',
    '  fs.writeFileSync(assistant, "final answer");',
    '  const receiptIndex = argv.indexOf("--receipt");',
    '  const invocationIndex = argv.indexOf("--invocation-id");',
    '  const receipt = { schemaVersion: 1, status: "completed", invocationId: argv[invocationIndex + 1], artifacts: { assistant, calls: null, extra: null, mainOutput: null, mainCalls: null, mainExtra: null }, model: "fake", finishReason: "stop", usage: null, hook: { status: "skipped", failureMode: "warn", reason: "not_configured" } };',
    '  fs.writeFileSync(argv[receiptIndex + 1], JSON.stringify(receipt));',
    '}',
    'fs.writeFileSync(process.env.PPR_LAYERED_STATE, JSON.stringify(state));'
  ].join('\n')
);

const phase = {};
const config = {
  cwd: tmp,
  inputDirectoriesAbs: [base, shared],
  outputDirectoryAbs: output,
  directoryAbs: output,
  authoritativeReadLayersAbs: [base, shared, output],
  userWritableAbs: output,
  quiet: true,
  inputMode: false,
  continueMode: true,
  maxStep: 3,
  phases: { thought: phase, observe: phase, check: phase, final: phase },
  prompts: {
    core: 'thought instructions',
    observe: 'observe instructions',
    check: 'check instructions',
    final: 'final instructions'
  }
};
const session = { sessionId: 'layered-session', workRootAbs: tmp, workDirectoryAbs: work };
const spawnConfig = {
  command: process.execPath,
  argvPrefix: [fakeCli],
  displayName: `node "${fakeCli}"`
};

const directoryValues = argv => argv.flatMap((value, index) => value === '-d' ? [argv[index + 1]] : []);

(async () => {
  try {
    process.env.PPR_LAYERED_CALLS_LOG = callsLog;
    process.env.PPR_LAYERED_STATE = statePath;

    const runtime = new PromptpileReactRuntime(config, session, spawnConfig);
    while (runtime.stopReason === 'running') await runtime.nextStep();
    await runtime.finalAnswer();

    assert.strictEqual(runtime.currentStep, 2);
    assert.strictEqual(runtime.stopReason, 'final');
    const calls = fs.readFileSync(callsLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.strictEqual(calls.length, 7, 'two loops plus Final cross the public CLI boundary');

    const thoughtCalls = calls.filter(argv => !argv.includes('--disable-tool') && !argv.includes('--tool-choice'));
    assert.strictEqual(thoughtCalls.length, 2);
    for (const argv of thoughtCalls) {
      assert.deepStrictEqual(directoryValues(argv), [base, shared, output]);
      assert.deepStrictEqual(
        argv.slice(argv.indexOf('--output-dir'), argv.indexOf('--output-dir') + 2),
        ['--output-dir', work]
      );
    }
    const observeCalls = calls.filter(argv => argv.includes('--disable-tool') && argv.includes('-o') && !argv.includes('--tool-choice'));
    assert.strictEqual(observeCalls.length, 2);
    for (const argv of observeCalls) {
      assert.deepStrictEqual(directoryValues(argv), [base, shared, output, work]);
      assert.ok(!argv.includes('--output-dir'));
    }
    const checkCalls = calls.filter(argv => argv.includes('--tool-choice'));
    assert.strictEqual(checkCalls.length, 2);
    for (const argv of checkCalls) {
      assert.strictEqual(directoryValues(argv).length, 1, 'Check sees only its empty temp directory');
      assert.ok(!argv.includes(base));
      assert.ok(!argv.includes(shared));
      assert.ok(!argv.includes(output));
      assert.ok(!argv.includes('--output-dir'));
    }

    const final = calls[calls.length - 1];
    assert.deepStrictEqual(directoryValues(final), [base, shared, output]);
    assert.deepStrictEqual(
      final.slice(final.indexOf('--output-dir'), final.indexOf('--output-dir') + 2),
      ['--output-dir', output]
    );
    assert.ok(!directoryValues(final).includes(work));
    assert.ok(final.includes('--append-files'));
    assert.ok(final.includes('--receipt'));

    assert.deepStrictEqual(fs.readdirSync(base), ['[0]system.md']);
    assert.deepStrictEqual(fs.readdirSync(shared), ['[0]user.md']);
    assert.deepStrictEqual(
      fs.readdirSync(output).sort(),
      ['[0]assistant.md'],
      'only Final is published to the authoritative output directory'
    );
    assert.deepStrictEqual(
      fs.readdirSync(work).sort(),
      [
        '.handoff',
        '[0]assistant.calls.jsonl',
        '[0]assistant.result.jsonl',
        '[1]assistant.calls.jsonl',
        '[1]assistant.result.jsonl',
        'final-receipt.json'
      ],
      'multi-step Thought calls/results remain in session-owned work'
    );

    console.log('promptpile-react layered runtime CLI boundary tests ok');
  } finally {
    if (previousLog === undefined) delete process.env.PPR_LAYERED_CALLS_LOG;
    else process.env.PPR_LAYERED_CALLS_LOG = previousLog;
    if (previousState === undefined) delete process.env.PPR_LAYERED_STATE;
    else process.env.PPR_LAYERED_STATE = previousState;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
