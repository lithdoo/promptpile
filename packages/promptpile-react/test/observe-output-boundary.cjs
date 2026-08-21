'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { ObserveReactProcess } = require(path.join(root, 'dist', 'react-processes.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-observe-boundary-'));
const authority = path.join(tmp, 'authority');
const work = path.join(tmp, 'work');
const fakeCli = path.join(tmp, 'fake-promptpile.cjs');
fs.mkdirSync(authority);
fs.mkdirSync(work);
fs.writeFileSync(
  fakeCli,
  [
    "'use strict';",
    "const fs = require('fs');",
    'const argv = process.argv.slice(2);',
    "const outputIndex = argv.indexOf('-o');",
    "if (process.env.PPR_OBSERVE_OUTPUT === 'empty') fs.writeFileSync(argv[outputIndex + 1], '  \\n');"
  ].join('\n')
);

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
  maxStep: 1,
  outputFormat: 'terminal',
  phases: { thought: phase, observe: phase, check: phase, final: phase },
  prompts: { core: '', observe: '', check: '', final: '' }
};
const session = { sessionId: 'observe-session', workRootAbs: tmp, workDirectoryAbs: work };
const spawn = {
  command: process.execPath,
  argvPrefix: [fakeCli],
  displayName: `node "${fakeCli}"`
};

(async () => {
  const previous = process.env.PPR_OBSERVE_OUTPUT;
  try {
    for (const testCase of [
      { mode: 'missing', diagnostic: /不存在|does not exist/ },
      { mode: 'empty', diagnostic: /为空|empty/ }
    ]) {
      process.env.PPR_OBSERVE_OUTPUT = testCase.mode;
      const processUnderTest = new ObserveReactProcess({ config, session, spawn }, 'observe');
      await assert.rejects(
        () => processUnderTest.run(),
        error => error.code === 'phase_output_missing' && testCase.diagnostic.test(error.message)
      );
    }
  } finally {
    if (previous === undefined) delete process.env.PPR_OBSERVE_OUTPUT;
    else process.env.PPR_OBSERVE_OUTPUT = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('promptpile-react Observe output boundary tests ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
