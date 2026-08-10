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
const fakeCli = path.join(tmp, 'fake-promptpile.cjs');
const callsLog = path.join(tmp, 'calls.jsonl');
const statePath = path.join(tmp, 'state.json');
const previousLog = process.env.PPR_LAYERED_CALLS_LOG;
const previousState = process.env.PPR_LAYERED_STATE;

for (const directory of [base, shared, output]) fs.mkdirSync(directory);
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
    '  const call = { function: { name: "react_check_decision", arguments: JSON.stringify({ decision }) } };',
    '  fs.writeFileSync(calls, JSON.stringify(call) + "\\n");',
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

    const runtime = new PromptpileReactRuntime(config, spawnConfig);
    while (runtime.stopReason === 'running') await runtime.nextStep();
    await runtime.finalAnswer();

    assert.strictEqual(runtime.currentStep, 2);
    assert.strictEqual(runtime.stopReason, 'final');
    const calls = fs.readFileSync(callsLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.strictEqual(calls.length, 7, 'two loops plus Final cross the public CLI boundary');

    const normalCalls = calls.filter(argv => !argv.includes('--tool-choice'));
    for (const argv of normalCalls) {
      assert.deepStrictEqual(directoryValues(argv), [base, shared]);
      assert.deepStrictEqual(
        argv.slice(argv.indexOf('--output-dir'), argv.indexOf('--output-dir') + 2),
        ['--output-dir', output]
      );
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

    assert.deepStrictEqual(fs.readdirSync(base), ['[0]system.md']);
    assert.deepStrictEqual(fs.readdirSync(shared), ['[0]user.md']);
    assert.deepStrictEqual(
      fs.readdirSync(output).sort(),
      [
        '[0]assistant.calls.jsonl',
        '[0]assistant.result.jsonl',
        '[1]assistant.calls.jsonl',
        '[1]assistant.result.jsonl'
      ],
      'multi-step calls/results stay in the writable output directory'
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
