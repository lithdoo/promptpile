'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-max-step-policy-'));
const messages = path.join(tmp, 'messages');
const invocationLog = path.join(tmp, 'invocations.jsonl');
const config = path.join(tmp, 'react.toml');
fs.mkdirSync(messages);
fs.writeFileSync(path.join(messages, '[0]user.md'), 'keep working');
fs.writeFileSync(path.join(messages, 'final.md'), 'produce the final answer');

const bundledPackage = require.resolve('promptpile/package.json');
const bundledMetadata = JSON.parse(fs.readFileSync(bundledPackage, 'utf8'));
const bundledBin = path.resolve(path.dirname(bundledPackage), bundledMetadata.bin.promptpile);
const originalBundledBin = fs.readFileSync(bundledBin);

const fake = path.join(tmp, 'fake-promptpile.cjs');
fs.writeFileSync(fake, [
  "const fs = require('fs'), path = require('path');",
  'const argv = process.argv.slice(2);',
  "fs.appendFileSync(process.env.PPR_INVOCATION_LOG, JSON.stringify(argv) + '\\n');",
  "const outputIndex = argv.indexOf('-o');",
  'if (outputIndex >= 0) {',
  '  const output = argv[outputIndex + 1];',
  "  fs.writeFileSync(output, 'phase output');",
  "  if (argv.includes('--tool-choice')) {",
  '    const parsed = path.parse(output);',
  '    const calls = path.join(parsed.dir, parsed.name + \'.calls.jsonl\');',
  "    const decision = process.env.PPR_CHECK_DECISION !== 'false';",
  "    const call = { id: 'check', type: 'function', function: { name: 'react_check_decision', arguments: JSON.stringify({ decision }) } };",
  "    fs.writeFileSync(calls, JSON.stringify(call) + '\\n');",
  '  }',
  '}',
  "const isFinal = argv.includes('--append-files') && !argv.includes('-o');",
  "if (isFinal && argv.includes('-c')) {",
  "  const directoryIndexes = argv.flatMap((value, index) => value === '-d' ? [index] : []);",
  '  const directory = argv[directoryIndexes.at(-1) + 1];',
  "  const assistant = path.join(directory, '[1]assistant.md');",
  "  fs.writeFileSync(assistant, 'final answer');",
  "  const receiptIndex = argv.indexOf('--receipt');",
  "  const invocationIndex = argv.indexOf('--invocation-id');",
  "  const artifacts = { assistant, calls: null, extra: null, mainOutput: null, mainCalls: null, mainExtra: null };",
  "  fs.writeFileSync(argv[receiptIndex + 1], JSON.stringify({ schemaVersion: 1, status: 'completed', invocationId: argv[invocationIndex + 1], artifacts }));",
  '}',
  "const fdIndex = argv.indexOf('--output-pile-fd');",
  'if (fdIndex >= 0) {',
  "  const stream = fs.createWriteStream('', { fd: Number(argv[fdIndex + 1]) });",
  "  stream.write(JSON.stringify({ type: 'assistant_delta', content: 'final answer' }) + '\\n');",
  "  stream.end(JSON.stringify({ type: 'assistant_done' }) + '\\n');",
  '}'
].join('\n'));

const writeConfig = policy => fs.writeFileSync(config, [
  '[promptpile-react]',
  `dirs = ["${messages.replace(/\\/g, '\\\\')}"]`,
  'max_step = 1',
  ...(policy === undefined ? [] : [`max_step_policy = "${policy}"`]),
  'final_prompt = "final.md"',
  ''
].join('\n'));

const run = (args, decision = true) => {
  fs.rmSync(invocationLog, { force: true });
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: tmp,
    encoding: 'utf8',
    env: {
      ...process.env,
      PROMPTPILE_BIN: '',
      PPR_INVOCATION_LOG: invocationLog,
      PPR_CHECK_DECISION: String(decision)
    }
  });
  const invocations = fs.existsSync(invocationLog)
    ? fs.readFileSync(invocationLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  return { ...result, invocations };
};

const hasFinalInvocation = invocations =>
  invocations.some(argv => argv.includes('--append-files') && !argv.includes('-o'));

try {
  fs.copyFileSync(fake, bundledBin);

  writeConfig(undefined);
  const compatible = run(['--config', config, '--continue']);
  assert.strictEqual(compatible.status, 0, compatible.stderr);
  assert.strictEqual(hasFinalInvocation(compatible.invocations), true, 'default policy still starts Final');
  assert.strictEqual(compatible.invocations.length, 4, 'default exhaustion runs Thought, Observe, Check and Final');
  assert.strictEqual(fs.existsSync(path.join(messages, '[1]assistant.md')), true, 'default Final may persist');
  fs.rmSync(path.join(messages, '[1]assistant.md'));

  const terminalFailure = run([
    '--config', config, '--max-step-policy', 'error', '--continue'
  ]);
  assert.notStrictEqual(terminalFailure.status, 0);
  assert.strictEqual(
    hasFinalInvocation(terminalFailure.invocations),
    false,
    `error policy never starts Final: ${JSON.stringify(terminalFailure.invocations)}`
  );
  assert.strictEqual(terminalFailure.invocations.length, 3, 'error exhaustion stops after Check');
  assert.match(terminalFailure.stderr, /React reached max_step while Check still requested continuation\./);
  assert.strictEqual(fs.existsSync(path.join(messages, '[1]assistant.md')), false, 'error exhaustion cannot persist Final');

  writeConfig('error');
  const converged = run(['--config', config], false);
  assert.strictEqual(converged.status, 0, converged.stderr);
  assert.strictEqual(hasFinalInvocation(converged.invocations), true, 'Check=false still enters Final under error policy');

  const streamFailure = run(['--config', config, '--output-format', 'stream-json']);
  assert.notStrictEqual(streamFailure.status, 0);
  assert.strictEqual(streamFailure.stderr.includes('final answer'), false);
  assert.strictEqual(hasFinalInvocation(streamFailure.invocations), false);
  const events = streamFailure.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.strictEqual(events.at(-1).type, 'session.failed');
  assert.strictEqual(events.at(-1).phase, 'check');
  assert.strictEqual(events.at(-1).error.code, 'max_step_exhausted');
  assert.strictEqual(events.at(-1).steps_completed, 1);
  assert.strictEqual(
    events.some(event =>
      event.type === 'phase.started' && event.phase === 'final' ||
      event.type === 'phase.completed' && event.phase === 'final' ||
      event.type === 'final.delta' ||
      event.type === 'session.completed'
    ),
    false,
    'error exhaustion emits no Final or success events'
  );
  const completedCheck = events.find(event => event.type === 'phase.completed' && event.phase === 'check');
  assert.strictEqual(completedCheck.continue, true);

  const invalidCli = run(['--config', config, '--max-step-policy', 'retry']);
  assert.notStrictEqual(invalidCli.status, 0);
  assert.match(invalidCli.stderr, /max-step-policy must be final or error/);
  assert.strictEqual(invalidCli.invocations.length, 0);

  console.log('promptpile-react max-step policy CLI tests ok');
} finally {
  fs.writeFileSync(bundledBin, originalBundledBin);
  fs.rmSync(tmp, { recursive: true, force: true });
}
