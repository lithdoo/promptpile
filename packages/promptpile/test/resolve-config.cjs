'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.join(__dirname, '..');
const { resolveConfig } = require(path.join(root, 'dist', 'resolve-config.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cfg-'));
const prevCwd = process.cwd();
const envKeys = [
  'AI_MODEL',
  'DEFAULT_DIRECTORY',
  'PROMPTPILE_LLM_API_EXTRA_BODY',
  'PROMPTPILE_OUTPUT_PILE_FILE',
  'PROMPTPILE_OUTPUT_PIPE',
  'PROMPTPILE_OUTPUT_PILE_FD',
  'PROMPTPILE_OUTPUT_PILE_FORMAT',
  'PROMPTPILE_OUTPUT_PIPE_FORMAT',
  'PROMPTPILE_TEST_KEY'
];
const envBefore = new Map(envKeys.map(key => [key, process.env[key]]));
try {
  process.chdir(tmp);
  process.env.AI_MODEL = 'm-proc';
  process.env.DEFAULT_DIRECTORY = 'ignored-env-directory';

  const msgRel = 'messages';
  const msgAbs = path.join(tmp, msgRel);
  fs.mkdirSync(msgAbs, { recursive: true });

  fs.writeFileSync(path.join(tmp, '.env'), `DEFAULT_DIRECTORY=${msgRel}\nAI_MODEL=m-cwd\n`);
  fs.writeFileSync(path.join(msgAbs, '.env'), 'AI_MODEL=m-scan\n');

  const fakeScript = path.join(tmp, 'fake-index.js');
  fs.writeFileSync(fakeScript, '');
  const cfg = resolveConfig(tmp, ['node', fakeScript, '-k', 'key']);
  assert.strictEqual(cfg.model, 'gpt-3.5-turbo', 'ordinary process.env and .env model config are ignored');
  assert.strictEqual(cfg.directory, msgAbs, 'default directory is used when CLI and TOML omit it');

  const tomlPath = path.join(tmp, 'app.toml');
  fs.writeFileSync(tomlPath, '[promptpile]\nllm_api_model = "m-toml"\n');
  const cfg2 = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(cfg2.model, 'm-toml', 'toml config sets model');

  const cfg3 = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key', '-m', 'm-cli']);
  assert.strictEqual(cfg3.model, 'm-cli', 'cli overrides toml');

  process.env.PROMPTPILE_TEST_KEY = 'key-from-env-name';
  fs.writeFileSync(tomlPath, '[promptpile]\nllm_api_key_env = \'PROMPTPILE_TEST_KEY\'\n');
  const cfgKeyEnv = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(cfgKeyEnv.apiKey, 'key-from-env-name', 'TOML api_key_env reads process.env');

  const cfgDefaultTemp = resolveConfig(tmp, ['node', fakeScript, '-k', 'key']);
  assert.strictEqual(cfgDefaultTemp.temperature, 0.8, 'default temperature when unset');
  assert.strictEqual(cfgDefaultTemp.missingToolResults, 'warn', 'default missing tool results policy');

  fs.writeFileSync(tomlPath, '[promptpile]\nmissing_tool_results = "ignore"\n');
  const cfgTomlMissing = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(cfgTomlMissing.missingToolResults, 'ignore', 'toml missing tool results policy');
  const cfgCliMissing = resolveConfig(tmp, [
    'node', fakeScript, '--config', 'app.toml', '-k', 'key',
    '--missing-tool-results', 'error'
  ]);
  assert.strictEqual(cfgCliMissing.missingToolResults, 'error', 'cli missing tool results policy overrides toml');

  fs.writeFileSync(
    tomlPath,
    '[promptpile]\nllm_api_temperature = 0.3\n'
  );
  const cfgTomlTemp = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(cfgTomlTemp.temperature, 0.3, 'toml llm_api_temperature');

  const cfgCliTemp = resolveConfig(tmp, [
    'node',
    fakeScript,
    '--config',
    'app.toml',
    '-k',
    'key',
    '--temperature',
    '0.1'
  ]);
  assert.strictEqual(cfgCliTemp.temperature, 0.1, 'cli --temperature overrides toml');

  fs.writeFileSync(
    tomlPath,
    '[promptpile]\nllm_api_extra_body = { a = 1 }\n'
  );
  const cfgTomlExtra = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.deepStrictEqual(cfgTomlExtra.extraBody, { a: 1 }, 'toml llm_api_extra_body');

  process.env.PROMPTPILE_LLM_API_EXTRA_BODY = '{"b":2}';
  const cfgEnvExtra = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.deepStrictEqual(cfgEnvExtra.extraBody, { a: 1 }, 'toml extra_body is unaffected by process.env');

  fs.writeFileSync(tomlPath, '[promptpile]\n');
  const cfgEnvExtraOnly = resolveConfig(tmp, ['node', fakeScript, '-k', 'key']);
  assert.strictEqual(cfgEnvExtraOnly.extraBody, undefined, 'ordinary process.env extra_body is ignored');

  const cfgCliExtra = resolveConfig(tmp, [
    'node',
    fakeScript,
    '--config',
    'app.toml',
    '-k',
    'key',
    '--extra-body',
    '{"c":3}'
  ]);
  assert.deepStrictEqual(cfgCliExtra.extraBody, { c: 3 }, 'cli --extra-body sets extra body');

  fs.writeFileSync(
    tomlPath,
    '[promptpile]\noutput_pile_file = "toml-new.jsonl"\noutput_pipe = "toml-old.jsonl"\noutput_pile_fd = 3\noutput_pile_format = "json"\n'
  );
  process.env.PROMPTPILE_OUTPUT_PILE_FILE = 'env-new.txt';
  process.env.PROMPTPILE_OUTPUT_PIPE = 'env-old.txt';
  process.env.PROMPTPILE_OUTPUT_PILE_FD = '5';
  process.env.PROMPTPILE_OUTPUT_PILE_FORMAT = 'text';
  const cfgTomlPile = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(cfgTomlPile.outputPileFile, 'toml-new.jsonl', 'toml output_pile_file overrides old toml alias');
  assert.strictEqual(cfgTomlPile.outputPileFd, 3, 'toml output_pile_fd');
  assert.strictEqual(cfgTomlPile.outputPileFormat, 'json', 'toml output_pile_format');

  fs.writeFileSync(tomlPath, '[promptpile]\noutput_pipe = "toml-old-only.jsonl"\noutput_pipe_format = "json"\n');
  const cfgOldTomlPile = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(cfgOldTomlPile.outputPileFile, 'toml-old-only.jsonl', 'old toml output_pipe alias');
  assert.strictEqual(cfgOldTomlPile.outputPileFormat, 'json', 'old toml output_pipe_format alias');

  fs.writeFileSync(tomlPath, '[promptpile]\n');
  const cfgEnvPile = resolveConfig(tmp, ['node', fakeScript, '-k', 'key']);
  assert.strictEqual(cfgEnvPile.outputPileFile, undefined, 'ordinary process.env output pile file is ignored');
  assert.strictEqual(cfgEnvPile.outputPileFd, undefined, 'ordinary process.env output pile fd is ignored');
  assert.strictEqual(cfgEnvPile.outputPileFormat, undefined, 'ordinary process.env output pile format is ignored');

  delete process.env.PROMPTPILE_OUTPUT_PILE_FILE;
  delete process.env.PROMPTPILE_OUTPUT_PILE_FORMAT;
  process.env.PROMPTPILE_OUTPUT_PIPE = 'env-old-only.txt';
  process.env.PROMPTPILE_OUTPUT_PIPE_FORMAT = 'json';
  const cfgOldEnvPile = resolveConfig(tmp, ['node', fakeScript, '-k', 'key']);
  assert.strictEqual(cfgOldEnvPile.outputPileFile, undefined, 'old process.env output pipe alias is ignored');
  assert.strictEqual(cfgOldEnvPile.outputPileFormat, undefined, 'old process.env output pipe format alias is ignored');

  const cfgCliPile = resolveConfig(tmp, [
    'node',
    fakeScript,
    '-k',
    'key',
    '--output-pile-file',
    'cli-stream.jsonl',
    '--output-pile-fd',
    '4',
    '--output-pile-format',
    'text'
  ]);
  assert.strictEqual(cfgCliPile.outputPileFile, 'cli-stream.jsonl', 'cli output pile file');
  assert.strictEqual(cfgCliPile.outputPileFd, 4, 'cli output pile fd');
  assert.strictEqual(cfgCliPile.outputPileFormat, 'text', 'cli output pile format');

  const cfgCliAliasPile = resolveConfig(tmp, [
    'node',
    fakeScript,
    '-k',
    'key',
    '--output-pipe',
    'cli-alias.jsonl',
    '--output-pipe-format',
    'json'
  ]);
  assert.strictEqual(cfgCliAliasPile.outputPileFile, 'cli-alias.jsonl', 'old cli output-pipe alias');
  assert.strictEqual(cfgCliAliasPile.outputPileFormat, 'json', 'old cli output-pipe-format alias');
} finally {
  process.chdir(prevCwd);
  for (const [key, value] of envBefore) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('resolve-config tests ok');
