'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const reactRoot = path.join(__dirname, '..');
const reactCli = path.join(reactRoot, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-real-promptpile-errors-'));
const profileSecret = 'real-profile-secret-must-not-leak';

const baseConfig = (phaseConfig, directoryConfig = 'dir = "messages"') => `
[[llm_api]]
name = "available"
model = "integration-model"
api_key_env = "PPR_REAL_PROFILE_KEY"
base_url = "http://127.0.0.1:1"

[promptpile-react]
${directoryConfig}
${phaseConfig}
`;

const runCase = (name, phaseConfig, directoryConfig) => {
  const cwd = path.join(tmp, name);
  const messages = path.join(cwd, 'messages');
  const configPath = path.join(cwd, 'app.toml');
  fs.mkdirSync(messages, { recursive: true });
  fs.writeFileSync(path.join(messages, '[0]user.md'), 'integration input');
  fs.writeFileSync(configPath, baseConfig(phaseConfig, directoryConfig));

  const env = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    PPR_REAL_PROFILE_KEY: profileSecret
  };
  delete env.PROMPTPILE_BIN;
  delete env.PPR_REAL_MISSING_PHASE_KEY;

  const result = spawnSync(
    process.execPath,
    [reactCli, '--config', configPath, '--max-step', '1'],
    { cwd, encoding: 'utf8', env, timeout: 15_000 }
  );

  assert.strictEqual(result.error, undefined, `${name}: ${result.error?.message ?? ''}`);
  assert.strictEqual(result.status, 1, `${name}: ${result.stderr}`);
  assert.doesNotMatch(result.stdout, new RegExp(profileSecret));
  assert.doesNotMatch(result.stderr, new RegExp(profileSecret));
  return result;
};

try {
  const missingProfile = runCase('missing-profile', 'thought_llm_api = "missing"');
  assert.match(missingProfile.stderr, /LLM API profile not found: missing/);
  assert.doesNotMatch(missingProfile.stderr, /AI API key is required/);

  const invalidTemperature = runCase(
    'invalid-temperature',
    'thought_llm_api = "available"\nthought_llm_api_temperature = "invalid-temperature"'
  );
  assert.match(invalidTemperature.stderr, /temperature/i);
  assert.match(invalidTemperature.stderr, /finite number|between 0 and 2/i);

  const invalidExtraBody = runCase(
    'invalid-extra-body',
    'thought_llm_api = "available"\nthought_llm_api_extra_body = "[]"'
  );
  assert.match(invalidExtraBody.stderr, /extra.body/i);
  assert.match(invalidExtraBody.stderr, /JSON object/i);

  const missingPhaseEnv = runCase(
    'missing-phase-env',
    'thought_llm_api = "available"\nthought_llm_api_key_env = "PPR_REAL_MISSING_PHASE_KEY"'
  );
  assert.match(
    missingPhaseEnv.stderr,
    /API key environment variable is not set or empty: PPR_REAL_MISSING_PHASE_KEY/
  );

  const layeredCwd = path.join(tmp, 'layered-parser');
  fs.mkdirSync(path.join(layeredCwd, 'base'), { recursive: true });
  fs.writeFileSync(path.join(layeredCwd, 'base', '[0]system.md'), 'base layer');
  const layeredParser = runCase(
    'layered-parser',
    'thought_llm_api = "missing-layered"',
    'dirs = ["base", "messages"]\noutput_dir = "session"\ncontinue = true'
  );
  assert.match(
    layeredParser.stderr,
    /LLM API profile not found: missing-layered/,
    'the real Promptpile parser accepts React repeated -d and --output-dir argv before profile validation'
  );
  assert.doesNotMatch(layeredParser.stderr, /unknown option|too many arguments/i);
  assert.ok(fs.statSync(path.join(layeredCwd, 'session')).isDirectory());

  console.log('promptpile-react real Promptpile config error tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
