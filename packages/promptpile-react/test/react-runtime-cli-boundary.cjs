'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { PromptpileReactRuntime } = require(path.join(root, 'dist', 'react-runtime.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-runtime-boundary-'));
const fakeCli = path.join(tmp, 'fake-promptpile.cjs');
const callsLog = path.join(tmp, 'calls.jsonl');
const messages = path.join(tmp, 'messages');
const configPath = path.join(tmp, 'react.toml');
const previousLog = process.env.PPR_RUNTIME_CALLS_LOG;
const previousSecret = process.env.PPR_RUNTIME_SECRET;

fs.mkdirSync(messages);
fs.writeFileSync(configPath, '[[llm_api]]\nname = "profile"\n');
fs.writeFileSync(
  fakeCli,
  [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(process.env.PPR_RUNTIME_CALLS_LOG, JSON.stringify(argv) + '\\n');",
    "const outputIndex = argv.indexOf('-o');",
    "const conversationOutputIndex = argv.indexOf('--output-dir');",
    "const profileIndex = argv.indexOf('--llm-api');",
    "const profileName = profileIndex >= 0 ? argv[profileIndex + 1] : '';",
    "let assistantPath = null;",
    "if (argv.includes('-c') && conversationOutputIndex >= 0) {",
    "  const directory = argv[conversationOutputIndex + 1];",
    "  fs.mkdirSync(directory, { recursive: true });",
    "  assistantPath = path.join(directory, '[0]assistant.md');",
    "  fs.writeFileSync(assistantPath, profileName === 'thought-profile' ? 'thought state' : 'final answer');",
    "}",
    'if (outputIndex >= 0) {',
    '  const output = argv[outputIndex + 1];',
    "  fs.writeFileSync(output, argv.includes('--tool-choice') ? 'check output' : 'observe report');",
    "  if (argv.includes('--tool-choice')) {",
    '    const parsed = path.parse(output);',
    '    const calls = path.join(parsed.dir, `${parsed.name}.calls.jsonl`);',
    '    const call = { id: "call-check", type: "function", function: { name: "react_check_decision", arguments: "{\\\"decision\\\":false}" } };',
    "    fs.writeFileSync(calls, JSON.stringify(call) + '\\n');",
    '  }',
    '}',
    "const receiptIndex = argv.indexOf('--receipt');",
    "if (receiptIndex >= 0) {",
    "  const invocationIndex = argv.indexOf('--invocation-id');",
    "  const receipt = { schemaVersion: 1, status: 'completed', invocationId: argv[invocationIndex + 1], artifacts: { assistant: assistantPath, calls: null, extra: null, mainOutput: null, mainCalls: null, mainExtra: null }, model: 'fake', finishReason: 'stop', usage: null, hook: { status: 'skipped', failureMode: 'warn', reason: 'not_configured' } };",
    "  fs.writeFileSync(argv[receiptIndex + 1], JSON.stringify(receipt));",
    "}"
  ].join('\n')
);

const profile = name => ({
  profileName: name,
  apiKeyEnvOverride: 'PPR_RUNTIME_SECRET'
});

const config = {
  cwd: tmp,
  configPath,
  inputDirectoriesAbs: [],
  outputDirectoryAbs: messages,
  directoryAbs: messages,
  authoritativeReadLayersAbs: [messages],
  userWritableAbs: messages,
  quiet: true,
  inputMode: false,
  continueMode: true,
  maxStep: 1,
  phases: {
    thought: profile('thought-profile'),
    observe: profile('observe-profile'),
    check: profile('check-profile'),
    final: profile('final-profile')
  },
  prompts: {
    core: 'thought instructions',
    observe: 'observe instructions',
    check: 'check instructions',
    final: 'final instructions'
  }
};

const work = path.join(tmp, 'work');
fs.mkdirSync(work);
const session = { sessionId: 'runtime-session', workRootAbs: tmp, workDirectoryAbs: work };

const spawnConfig = {
  command: process.execPath,
  argvPrefix: [fakeCli],
  displayName: `node "${fakeCli}"`
};

(async () => {
  try {
    process.env.PPR_RUNTIME_CALLS_LOG = callsLog;
    process.env.PPR_RUNTIME_SECRET = 'must-not-appear-in-argv';

    const runtime = new PromptpileReactRuntime(config, session, spawnConfig);
    await runtime.nextStep();
    await runtime.finalAnswer();

    assert.strictEqual(runtime.currentStep, 1);
    assert.strictEqual(runtime.stopReason, 'final');

    const calls = fs.readFileSync(callsLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.strictEqual(calls.length, 4, 'Thought, Observe, Check and Final each cross the CLI boundary');

    const [thought, observe, check, final] = calls;
    for (const [index, phase] of ['thought', 'observe', 'check', 'final'].entries()) {
      const argv = calls[index];
      assert.deepStrictEqual(
        argv.slice(argv.indexOf('--llm-config'), argv.indexOf('--llm-config') + 2),
        ['--llm-config', configPath]
      );
      assert.deepStrictEqual(
        argv.slice(argv.indexOf('--llm-api'), argv.indexOf('--llm-api') + 2),
        ['--llm-api', `${phase}-profile`]
      );
      assert.deepStrictEqual(
        argv.slice(argv.indexOf('--api-key-env'), argv.indexOf('--api-key-env') + 2),
        ['--api-key-env', 'PPR_RUNTIME_SECRET']
      );
      assert.ok(!argv.includes('must-not-appear-in-argv'), 'resolved secrets never enter argv');
    }

    assert.ok(thought.includes('--insert-files'));
    assert.ok(thought.includes('-c'));
    assert.ok(!thought.includes('--disable-tool'));
    assert.deepStrictEqual(
      thought.slice(thought.indexOf('--output-dir'), thought.indexOf('--output-dir') + 2),
      ['--output-dir', work]
    );

    assert.ok(observe.includes('--append-files'));
    assert.ok(observe.includes('--disable-tool'));
    assert.ok(!observe.includes('-c'));
    assert.ok(!observe.includes('--output-dir'));
    assert.ok(!observe.includes('--receipt'));
    assert.ok(!observe.includes('--invocation-id'));
    assert.ok(!fs.existsSync(path.join(work, '.observe_files')));
    assert.deepStrictEqual(
      fs.readdirSync(work).filter(name => /^\[\d+\]assistant\.md$/.test(name)),
      ['[0]assistant.md'],
      'default carryover=0 persists Thought only'
    );

    assert.ok(check.includes('--insert-files'));
    assert.ok(check.includes('--tools-file'));
    assert.ok(check.includes('--tool-choice'));

    assert.ok(final.includes('--insert-files'));
    assert.ok(final.includes('--append-files'));
    assert.ok(final.includes('--disable-tool'));
    assert.ok(final.includes('-c'));
    assert.ok(!final.includes(work), 'Final does not read the internal work Conversation');
    assert.ok(final.includes('--receipt'), 'persisted Final requires a Completion Receipt');

    console.log('promptpile-react runtime CLI boundary tests ok');
  } finally {
    if (previousLog === undefined) {
      delete process.env.PPR_RUNTIME_CALLS_LOG;
    } else {
      process.env.PPR_RUNTIME_CALLS_LOG = previousLog;
    }
    if (previousSecret === undefined) {
      delete process.env.PPR_RUNTIME_SECRET;
    } else {
      process.env.PPR_RUNTIME_SECRET = previousSecret;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
