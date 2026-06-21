'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.join(__dirname, '..');
const { resolveReactConfig } = require(path.join(root, 'dist', 'resolve-react-config.js'));
const { buildPhaseArgv } = require(path.join(root, 'dist', 'build-phase-argv.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-cfg-'));
const prevCwd = process.cwd();
const envKeys = ['PROMPTPILE_REACT_MAX_STEP', 'DEEPSEEK_API_KEY'];
const envBefore = new Map(envKeys.map(key => [key, process.env[key]]));
try {
  process.chdir(tmp);
  process.env.PROMPTPILE_REACT_MAX_STEP = '5';
  process.env.DEEPSEEK_API_KEY = 'secret-from-named-env';

  const msgRel = 'messages';
  const msgAbs = path.join(tmp, msgRel);
  fs.mkdirSync(msgAbs, { recursive: true });

  const tomlPath = path.join(tmp, 'app.toml');
  fs.writeFileSync(
    tomlPath,
    `
[[llm_api]]
name = "deepseek"
model = "chat"
base_url = "https://api.example/v1"
api_key_env = "DEEPSEEK_API_KEY"

[promptpile]
dir = "other-dir"

[promptpile-react]
dir = "${msgRel}"
max_step = 3
thought_llm_api = "deepseek"
`
  );

  fs.writeFileSync(
    path.join(msgAbs, '.env'),
    'PROMPTPILE_REACT_MAX_STEP=7\n'
  );

  const fakeScript = path.join(tmp, 'fake-index.js');
  fs.writeFileSync(fakeScript, '');

  const cfg = resolveReactConfig(tmp, [
    'node',
    fakeScript,
    '--config',
    'app.toml'
  ]);
  assert.strictEqual(cfg.directoryAbs, msgAbs, 'promptpile-react dir wins over promptpile');
  assert.strictEqual(cfg.maxStep, 3, 'toml max_step is used');
  assert.strictEqual(cfg.phases.thought.apiKey, 'secret-from-named-env', 'TOML api_key_env reads its named environment variable');

  fs.writeFileSync(
    tomlPath,
    `
[[llm_api]]
name = "deepseek"
model = "chat"
base_url = "https://api.example/v1"

[promptpile-react]
dir = "${msgRel}"
thought_llm_api = "deepseek"
`
  );
  const cfgEnvOnly = resolveReactConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(cfgEnvOnly.maxStep, Number.POSITIVE_INFINITY, 'ordinary process.env max_step is ignored');

  const cfgCli = resolveReactConfig(tmp, [
    'node',
    fakeScript,
    '--config',
    'app.toml',
    '-m',
    'm-cli'
  ]);
  assert.strictEqual(cfgCli.phases.thought.model, 'm-cli', 'cli -m overrides phase model');

  const cfgDefaultTemp = resolveReactConfig(tmp, ['node', fakeScript, '-k', 'key']);
  assert.strictEqual(cfgDefaultTemp.phases.thought.temperature, 0.8, 'default temperature');

  fs.writeFileSync(
    tomlPath,
    `
[promptpile]
llm_api_temperature = 0.4

[promptpile-react]
llm_api_temperature = 0.3
`
  );
  const cfgSharedReactTemp = resolveReactConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(
    cfgSharedReactTemp.phases.thought.temperature,
    0.3,
    'promptpile-react shared temperature overrides promptpile shared temperature'
  );

  fs.writeFileSync(
    tomlPath,
    `
[[llm_api]]
name = "deepseek"
model = "chat"
base_url = "https://api.example/v1"

[promptpile-react]
dir = "${msgRel}"
thought_llm_api = "deepseek"
thought_llm_api_temperature = 0.3
`
  );
  const cfgTomlTemp = resolveReactConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(cfgTomlTemp.phases.thought.temperature, 0.3, 'toml thought_llm_api_temperature');

  const cfgCliTemp = resolveReactConfig(tmp, [
    'node',
    fakeScript,
    '--config',
    'app.toml',
    '-k',
    'key',
    '--temperature',
    '0.1'
  ]);
  assert.strictEqual(cfgCliTemp.phases.thought.temperature, 0.1, 'cli --temperature');
  assert.strictEqual(cfgCliTemp.phases.observe.temperature, 0.1, 'cli --temperature observe');
  assert.strictEqual(cfgCliTemp.phases.check.temperature, 0.1, 'cli --temperature check');

  const thoughtArgv = buildPhaseArgv('thought', cfgTomlTemp);
  const tempIdx = thoughtArgv.indexOf('--temperature');
  assert.ok(tempIdx >= 0, 'thought argv has --temperature');
  assert.strictEqual(thoughtArgv[tempIdx + 1], '0.3', 'thought argv temperature value');

  const observeArgv = buildPhaseArgv('observe', cfg);
  assert.ok(!observeArgv.includes('--config'), 'observe argv has no --config');
  assert.ok(!observeArgv.includes('--after-hook-path'), 'observe argv has no after-hook');
  assert.ok(!observeArgv.includes('--tool-choice'), 'observe argv has no tool-choice');
  assert.ok(observeArgv.includes('--disable-tool'), 'observe argv disables tools');

  const checkArgv = buildPhaseArgv('check', cfg);
  assert.ok(!checkArgv.includes('--config'), 'check argv has no --config');
  const checkTcIdx = checkArgv.indexOf('--tool-choice');
  assert.ok(checkTcIdx >= 0, 'check argv has --tool-choice');
  assert.strictEqual(
    checkArgv[checkTcIdx + 1],
    'function:react_check_decision',
    'check forces react_check_decision'
  );

  const finalArgv = buildPhaseArgv('final', cfg);
  assert.ok(finalArgv.includes('--disable-tool'), 'final argv has --disable-tool');

  const cfgCont = resolveReactConfig(tmp, [
    'node',
    fakeScript,
    '--config',
    'app.toml',
    '-c'
  ]);
  assert.strictEqual(cfgCont.continueMode, true, 'cli -c sets continueMode');
  const thoughtContArgv = buildPhaseArgv('thought', cfgCont);
  assert.ok(thoughtContArgv.includes('-c'), 'thought argv has -c when continueMode');
  const observeContArgv = buildPhaseArgv('observe', cfgCont);
  assert.ok(!observeContArgv.includes('-c'), 'observe argv must not have -c');
  const finalContArgv = buildPhaseArgv('final', cfgCont);
  assert.ok(finalContArgv.includes('-c'), 'final argv has -c when continueMode');

  fs.writeFileSync(
    tomlPath,
    `
[[llm_api]]
name = "deepseek"
model = "chat"
base_url = "https://api.example/v1"

[promptpile-react]
dir = "${msgRel}"
thought_llm_api = "deepseek"
thought_llm_api_extra_body = { phase = "thought" }
`
  );
  const cfgTomlExtra = resolveReactConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.deepStrictEqual(
    cfgTomlExtra.phases.thought.extraBody,
    { phase: 'thought' },
    'toml thought_llm_api_extra_body'
  );

  const cfgCliExtra = resolveReactConfig(tmp, [
    'node',
    fakeScript,
    '--config',
    'app.toml',
    '-k',
    'key',
    '--extra-body',
    '{"cli":1}'
  ]);
  assert.deepStrictEqual(cfgCliExtra.phases.thought.extraBody, { cli: 1 }, 'cli --extra-body thought');
  assert.deepStrictEqual(cfgCliExtra.phases.observe.extraBody, { cli: 1 }, 'cli --extra-body observe');
  assert.deepStrictEqual(cfgCliExtra.phases.check.extraBody, { cli: 1 }, 'cli --extra-body check');

  fs.writeFileSync(
    tomlPath,
    `
[[llm_api]]
name = "deepseek"
model = "chat"
base_url = "https://api.example/v1"

[promptpile-react]
dir = "${msgRel}"
thought_llm_api = "deepseek"
check_llm_api_temperature = 0.25
`
  );
  const cfgCheckTemp = resolveReactConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(cfgCheckTemp.phases.check.temperature, 0.25, 'toml check_llm_api_temperature');

  const thoughtExtraArgv = buildPhaseArgv('thought', cfgTomlExtra);
  const extraIdx = thoughtExtraArgv.indexOf('--extra-body');
  assert.ok(extraIdx >= 0, 'thought argv has --extra-body');
  assert.strictEqual(
    thoughtExtraArgv[extraIdx + 1],
    JSON.stringify({ phase: 'thought' }),
    'thought argv extra-body value'
  );

  const cfgNoExtraArgv = buildPhaseArgv('observe', cfgDefaultTemp);
  assert.ok(!cfgNoExtraArgv.includes('--extra-body'), 'observe argv omits --extra-body when unset');
} finally {
  process.chdir(prevCwd);
  for (const [key, value] of envBefore) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('resolve-react-config tests ok');
