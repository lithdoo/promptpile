'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { PromptpileReactRuntime } = require(path.join(root, 'dist', 'react-runtime.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-carryover-runtime-'));
const authority = path.join(tmp, 'authority');
const work = path.join(tmp, 'work');
const fakeCli = path.join(tmp, 'fake-promptpile.cjs');
const checkState = path.join(tmp, 'check-state.txt');
fs.mkdirSync(authority);
fs.mkdirSync(work);

fs.writeFileSync(fakeCli, [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  'const argv = process.argv.slice(2);',
  "const outputIndex = argv.indexOf('-o');",
  "const outputDirIndex = argv.indexOf('--output-dir');",
  "const isCheck = argv.includes('--tool-choice');",
  "let assistant = null;",
  "if (argv.includes('-c') && outputDirIndex >= 0) {",
  "  const dir = argv[outputDirIndex + 1];",
  "  const indices = fs.readdirSync(dir).map(name => /^\\[(\\d+)\\](?:assistant|user|system)\\.md$/.exec(name)).filter(Boolean).map(match => Number(match[1]));",
  "  const next = indices.length === 0 ? 0 : Math.max(...indices) + 1;",
  "  assistant = path.join(dir, `[${next}]assistant.md`);",
  "  fs.writeFileSync(assistant, outputIndex >= 0 ? `observe ${next}` : `thought ${next}`);",
  "}",
  "if (outputIndex >= 0) {",
  "  const output = argv[outputIndex + 1];",
  "  fs.writeFileSync(output, isCheck ? 'check' : fs.readFileSync(assistant, 'utf8'));",
  "  if (isCheck) {",
  "    const count = fs.existsSync(process.env.PPR_CHECK_STATE) ? Number(fs.readFileSync(process.env.PPR_CHECK_STATE, 'utf8')) : 0;",
  "    fs.writeFileSync(process.env.PPR_CHECK_STATE, String(count + 1));",
  "    const parsed = path.parse(output);",
  "    const calls = path.join(parsed.dir, `${parsed.name}.calls.jsonl`);",
  "    const call = { id: 'check', type: 'function', function: { name: 'react_check_decision', arguments: JSON.stringify({ decision: count < 2 }) } };",
  "    fs.writeFileSync(calls, JSON.stringify(call) + '\\n');",
  "  }",
  "}",
  "const receiptIndex = argv.indexOf('--receipt');",
  "if (receiptIndex >= 0) {",
  "  const invocationIndex = argv.indexOf('--invocation-id');",
  "  const mainOutput = outputIndex >= 0 ? argv[outputIndex + 1] : null;",
  "  const receipt = { schemaVersion: 1, status: 'completed', invocationId: argv[invocationIndex + 1], artifacts: { assistant, calls: null, extra: null, mainOutput, mainCalls: null, mainExtra: null } };",
  "  fs.writeFileSync(argv[receiptIndex + 1], JSON.stringify(receipt));",
  "}"
].join('\n'));

const phase = {};
const config = {
  cwd: tmp,
  inputDirectoriesAbs: [authority],
  directoryAbs: authority,
  authoritativeReadLayersAbs: [authority],
  userWritableAbs: authority,
  quiet: true,
  inputMode: false,
  continueMode: false,
  maxStep: 3,
  observeCarryover: 2,
  outputFormat: 'terminal',
  phases: { thought: phase, observe: phase, check: phase, final: phase },
  prompts: { core: '', observe: '', check: '', final: '' }
};
const session = { sessionId: 'carryover-session', workRootAbs: tmp, workDirectoryAbs: work };
const spawn = { command: process.execPath, argvPrefix: [fakeCli], displayName: 'fake promptpile' };

(async () => {
  const previous = process.env.PPR_CHECK_STATE;
  try {
    process.env.PPR_CHECK_STATE = checkState;
    const runtime = new PromptpileReactRuntime(config, session, spawn);
    while (runtime.stopReason === 'running') await runtime.nextStep();

    assert.strictEqual(runtime.currentStep, 3);
    assert.strictEqual(runtime.stopReason, 'final');
    assert.deepStrictEqual(
      fs.readdirSync(work).filter(name => /^\[\d+\]assistant\.md$/.test(name)).sort(),
      ['[0]assistant.md', '[2]assistant.md', '[3]assistant.md', '[4]assistant.md', '[5]assistant.md']
    );
    const archive = path.join(work, '.observe_files');
    assert.ok(fs.existsSync(path.join(archive, '[1]assistant.md')));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(archive, 'index.json'), 'utf8')).indices, [1, 3, 5]);
    assert.ok(fs.existsSync(path.join(work, '[5]assistant.md')), 'newest Observe remains active');
  } finally {
    if (previous === undefined) delete process.env.PPR_CHECK_STATE;
    else process.env.PPR_CHECK_STATE = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('promptpile-react Observe carryover runtime tests ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
