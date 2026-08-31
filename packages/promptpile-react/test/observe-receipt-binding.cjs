'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { ObserveReactProcess } = require(path.join(root, 'dist', 'react-processes.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-observe-receipt-'));
const authority = path.join(tmp, 'authority');
const fakeCli = path.join(tmp, 'fake-promptpile.cjs');
fs.mkdirSync(authority);
fs.writeFileSync(fakeCli, [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  'const argv = process.argv.slice(2);',
  "const output = argv[argv.indexOf('-o') + 1];",
  "const work = argv[argv.indexOf('--output-dir') + 1];",
  "const receiptPath = argv[argv.indexOf('--receipt') + 1];",
  "const invocation = argv[argv.indexOf('--invocation-id') + 1];",
  "fs.writeFileSync(output, 'current observe');",
  "const assistant = path.join(work, '[1]assistant.md');",
  "const otherAssistant = path.join(work, '[0]assistant.md');",
  "const otherOutput = path.join(work, 'other-output.md');",
  "fs.writeFileSync(assistant, 'persisted observe');",
  "fs.writeFileSync(otherAssistant, 'other observe');",
  "fs.writeFileSync(otherOutput, 'other output');",
  "const mode = process.env.PPR_RECEIPT_MODE;",
  "const artifacts = { assistant: mode === 'assistant-null' ? null : mode === 'wrong-assistant' ? otherAssistant : assistant, calls: null, extra: null, mainOutput: mode === 'wrong-output' ? otherOutput : output, mainCalls: null, mainExtra: null };",
  "const receipt = { schemaVersion: 1, status: 'completed', invocationId: mode === 'wrong-id' ? 'wrong' : invocation, artifacts };",
  "fs.writeFileSync(receiptPath, JSON.stringify(receipt));"
].join('\n'));

const phase = {};
const baseConfig = {
  cwd: tmp,
  inputDirectoriesAbs: [authority],
  directoryAbs: authority,
  authoritativeReadLayersAbs: [authority],
  userWritableAbs: authority,
  quiet: true,
  inputMode: false,
  continueMode: false,
  maxStep: 1,
  observeCarryover: 1,
  outputFormat: 'terminal',
  phases: { thought: phase, observe: phase, check: phase, final: phase },
  prompts: { core: '', observe: '', check: '', final: '' }
};
const spawn = { command: process.execPath, argvPrefix: [fakeCli], displayName: 'fake promptpile' };

(async () => {
  const previous = process.env.PPR_RECEIPT_MODE;
  try {
    for (const mode of ['wrong-output', 'wrong-assistant', 'wrong-id', 'assistant-null']) {
      const work = path.join(tmp, mode);
      fs.mkdirSync(work);
      const session = { sessionId: `session-${mode}`, workRootAbs: tmp, workDirectoryAbs: work };
      process.env.PPR_RECEIPT_MODE = mode;
      const processUnderTest = new ObserveReactProcess({ config: baseConfig, session, spawn }, 'observe');
      await assert.rejects(() => processUnderTest.run(0), error => error.code === 'internal_error');
    }
  } finally {
    if (previous === undefined) delete process.env.PPR_RECEIPT_MODE;
    else process.env.PPR_RECEIPT_MODE = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('promptpile-react Observe Receipt binding tests ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
