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
  'PROMPTPILE_TEST_KEY',
  'PROMPTPILE_CLI_KEY'
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
  assert.strictEqual(
    cfg.conversationIo.anchorDirectory,
    msgAbs,
    'default directory is used when CLI and TOML omit it'
  );

  const tomlPath = path.join(tmp, 'app.toml');
  fs.writeFileSync(tomlPath, '[promptpile]\nllm_api_model = "m-toml"\n');
  const cfg2 = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key']);
  assert.strictEqual(cfg2.model, 'm-toml', 'toml config sets model');

  const cfg3 = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '-k', 'key', '-m', 'm-cli']);
  assert.strictEqual(cfg3.model, 'm-cli', 'cli overrides toml');

  fs.writeFileSync(
    tomlPath,
    [
      '[promptpile]',
      'llm_api = "ReAsOnInG"',
      'llm_api_model = "runtime-model"',
      'llm_api_temperature = 0.4',
      'llm_api_extra_body = { source = "runtime" }',
      '',
      '[[llm_api]]',
      'name = "reasoning"',
      'model = "profile-model"',
      'base_url = "https://profile.example/v1"',
      'temperature = 0.6',
      'extra_body = { source = "profile" }',
      ''
    ].join('\n')
  );
  const cfgProfile = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(cfgProfile.model, 'runtime-model', 'promptpile model overrides selected profile');
  assert.strictEqual(cfgProfile.apiBaseUrl, 'https://profile.example/v1', 'profile supplies an unset base URL');
  assert.strictEqual(cfgProfile.temperature, 0.4, 'promptpile temperature overrides selected profile');
  assert.deepStrictEqual(
    cfgProfile.extraBody,
    { source: 'runtime' },
    'promptpile extra body overrides selected profile'
  );

  const cfgProfileCli = resolveConfig(tmp, [
    'node', fakeScript, '--config', 'app.toml',
    '--model', 'cli-model',
    '--api-base-url', 'https://cli.example/v1',
    '--temperature', '0.2',
    '--extra-body', '{"source":"cli"}'
  ]);
  assert.strictEqual(cfgProfileCli.model, 'cli-model', 'CLI model overrides runtime and profile');
  assert.strictEqual(cfgProfileCli.apiBaseUrl, 'https://cli.example/v1', 'CLI base URL overrides profile');
  assert.strictEqual(cfgProfileCli.temperature, 0.2, 'CLI temperature overrides runtime and profile');
  assert.deepStrictEqual(cfgProfileCli.extraBody, { source: 'cli' }, 'CLI extra body overrides runtime and profile');

  const runtimeTomlPath = path.join(tmp, 'runtime.toml');
  const profilesTomlPath = path.join(tmp, 'profiles.toml');
  fs.writeFileSync(
    runtimeTomlPath,
    [
      '[promptpile]',
      'dir = "messages"',
      'llm_api = "reasoning"',
      'llm_api_temperature = 0.35',
      '',
      '[[llm_api]]',
      'name = "reasoning"',
      'model = "runtime-file-profile"',
      '',
      '[[llm_api]]',
      'name = "invalid-but-shadowed"',
      'temperature = "not-a-number"',
      ''
    ].join('\n')
  );
  fs.writeFileSync(
    profilesTomlPath,
    [
      '[promptpile]',
      'dir = "must-be-ignored"',
      'llm_api = "must-be-ignored"',
      'llm_api_model = "must-be-ignored"',
      '',
      '[promptpile-react]',
      'max_step = 99',
      '',
      '[[llm_api]]',
      'name = "reasoning"',
      'model = "profile-db-reasoning"',
      'base_url = "https://reasoning.example/v1"',
      'api_key = "reasoning-profile-key"',
      'temperature = 0.7',
      'extra_body = { source = "reasoning-profile" }',
      '',
      '[[llm_api]]',
      'name = "observer"',
      'model = "profile-db-observer"',
      'base_url = "https://observer.example/v1"',
      'temperature = 0.5',
      ''
    ].join('\n')
  );

  const cfgSeparateProfiles = resolveConfig(tmp, [
    'node', fakeScript,
    '--config', 'runtime.toml',
    '--llm-config', 'profiles.toml'
  ]);
  assert.strictEqual(
    cfgSeparateProfiles.conversationIo.anchorDirectory,
    msgAbs,
    '--config remains the runtime config source'
  );
  assert.strictEqual(cfgSeparateProfiles.model, 'profile-db-reasoning', '--llm-config replaces the profile source');
  assert.strictEqual(cfgSeparateProfiles.apiBaseUrl, 'https://reasoning.example/v1');
  assert.strictEqual(cfgSeparateProfiles.apiKey, 'reasoning-profile-key');
  assert.strictEqual(cfgSeparateProfiles.temperature, 0.35, 'runtime field overrides llm-config profile field');
  assert.deepStrictEqual(cfgSeparateProfiles.extraBody, { source: 'reasoning-profile' });

  const cfgExplicitProfile = resolveConfig(tmp, [
    'node', fakeScript,
    '--config', 'runtime.toml',
    '--llm-config', 'profiles.toml',
    '--llm-api', 'ObSeRvEr'
  ]);
  assert.strictEqual(cfgExplicitProfile.model, 'profile-db-observer', '--llm-api overrides configured profile name');
  assert.strictEqual(cfgExplicitProfile.apiBaseUrl, 'https://observer.example/v1');
  assert.strictEqual(cfgExplicitProfile.temperature, 0.35, 'runtime field still overrides explicitly selected profile');

  const cfgProfileOnly = resolveConfig(tmp, [
    'node', fakeScript,
    '--llm-config', 'profiles.toml',
    '--llm-api', 'reasoning'
  ]);
  assert.strictEqual(
    cfgProfileOnly.conversationIo.anchorDirectory,
    msgAbs,
    'runtime fields in --llm-config are ignored'
  );
  assert.strictEqual(cfgProfileOnly.model, 'profile-db-reasoning');
  assert.strictEqual(cfgProfileOnly.temperature, 0.7);
  assert.deepStrictEqual(cfgProfileOnly.extraBody, { source: 'reasoning-profile' });

  const cfgProfileWithCliField = resolveConfig(tmp, [
    'node', fakeScript,
    '--llm-config', 'profiles.toml',
    '--llm-api', 'reasoning',
    '--model', 'explicit-cli-model',
    '--temperature', '0.15'
  ]);
  assert.strictEqual(cfgProfileWithCliField.model, 'explicit-cli-model', 'CLI field overrides llm-config profile');
  assert.strictEqual(cfgProfileWithCliField.temperature, 0.15, 'CLI temperature overrides llm-config profile');

  fs.writeFileSync(
    tomlPath,
    '[promptpile]\nllm_api = "missing"\n\n[[llm_api]]\nname = "available"\nmodel = "profile-model"\n'
  );
  const cfgMissingProfile = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(
    cfgMissingProfile.model,
    'gpt-3.5-turbo',
    'a missing profile selected by existing config currently falls back to defaults'
  );

  process.env.PROMPTPILE_TEST_KEY = 'key-from-env-name';
  fs.writeFileSync(tomlPath, '[promptpile]\nllm_api_key_env = \'PROMPTPILE_TEST_KEY\'\n');
  const cfgKeyEnv = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(cfgKeyEnv.apiKey, 'key-from-env-name', 'TOML api_key_env reads process.env');

  fs.writeFileSync(
    tomlPath,
    '[promptpile]\nllm_api_key = "direct-key"\nllm_api_key_env = "PROMPTPILE_TEST_KEY"\n'
  );
  const cfgDirectAndEnv = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(cfgDirectAndEnv.apiKey, 'direct-key', 'direct key currently wins over env-backed key in one layer');

  fs.writeFileSync(
    tomlPath,
    '[promptpile]\nllm_api = "keys"\n\n[[llm_api]]\nname = "keys"\napi_key = "profile-direct"\napi_key_env = "PROMPTPILE_TEST_KEY"\n'
  );
  const cfgProfileKeys = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(cfgProfileKeys.apiKey, 'profile-direct', 'profile direct key currently wins over profile env key');

  fs.writeFileSync(
    tomlPath,
    '[promptpile]\nllm_api = "keys"\nllm_api_key = "runtime-key"\n\n[[llm_api]]\nname = "keys"\napi_key = "profile-direct"\n'
  );
  const cfgRuntimeKey = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(cfgRuntimeKey.apiKey, 'runtime-key', 'promptpile direct key overrides profile key');
  const cfgCliKey = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml', '--api-key', 'cli-key']);
  assert.strictEqual(cfgCliKey.apiKey, 'cli-key', 'CLI key overrides promptpile and profile keys');

  process.env.PROMPTPILE_CLI_KEY = 'key-from-explicit-cli-env';
  const cfgCliKeyEnv = resolveConfig(tmp, [
    'node', fakeScript,
    '--config', 'app.toml',
    '--api-key-env', 'PROMPTPILE_CLI_KEY'
  ]);
  assert.strictEqual(
    cfgCliKeyEnv.apiKey,
    'key-from-explicit-cli-env',
    '--api-key-env overrides promptpile and profile key sources'
  );

  delete process.env.PROMPTPILE_TEST_KEY;
  fs.writeFileSync(tomlPath, '[promptpile]\nllm_api_key_env = "PROMPTPILE_TEST_KEY"\n');
  const cfgMissingEnv = resolveConfig(tmp, ['node', fakeScript, '--config', 'app.toml']);
  assert.strictEqual(cfgMissingEnv.apiKey, '', 'missing API key environment variable currently resolves to empty');
  process.env.PROMPTPILE_TEST_KEY = 'key-from-env-name';

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
  assert.deepStrictEqual(cfgTomlPile.outputPileTarget, {
    kind: 'fd', fd: 3, source: 'toml', shadowedFile: 'toml-new.jsonl'
  }, 'same-source fd wins while retaining the shadowed file diagnostic');

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
  assert.deepStrictEqual(cfgCliPile.outputPileTarget, {
    kind: 'fd', fd: 4, source: 'cli', shadowedFile: 'cli-stream.jsonl'
  }, 'same-source CLI fd wins');

  fs.writeFileSync(tomlPath, '[promptpile]\noutput_pile_fd = 3\n');
  const cfgCliFileTomlFd = resolveConfig(tmp, [
    'node', fakeScript, '--config', 'app.toml', '-k', 'key',
    '--output-pile-file', 'cli-wins.txt'
  ]);
  assert.deepStrictEqual(cfgCliFileTomlFd.outputPileTarget, {
    kind: 'file', path: 'cli-wins.txt', source: 'cli'
  }, 'CLI file target group wins over TOML fd');

  fs.writeFileSync(tomlPath, '[promptpile]\noutput_pile_file = "toml-loses.txt"\n');
  const cfgCliFdTomlFile = resolveConfig(tmp, [
    'node', fakeScript, '--config', 'app.toml', '-k', 'key',
    '--output-pile-fd', '4'
  ]);
  assert.deepStrictEqual(cfgCliFdTomlFile.outputPileTarget, {
    kind: 'fd', fd: 4, source: 'cli', shadowedFile: undefined
  }, 'CLI fd target group wins over TOML file');

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
