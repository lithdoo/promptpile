'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-llm-config-cli-'));

const run = args => spawnSync(process.execPath, [cli, ...args], {
  cwd: tmp,
  encoding: 'utf8',
  env: { ...process.env, NODE_NO_WARNINGS: '1' }
});

try {
  const profiles = path.join(tmp, 'profiles.toml');
  fs.writeFileSync(profiles, '[[llm_api]]\nname = "available"\nmodel = "model"\n');

  const missingProfile = run([
    '--llm-config', profiles,
    '--llm-api', 'missing'
  ]);
  assert.strictEqual(missingProfile.status, 1);
  assert.match(missingProfile.stderr, /Error: LLM API profile not found: missing/);
  assert.doesNotMatch(missingProfile.stderr, /AI API key is required/);

  const missingFile = run([
    '--llm-config', path.join(tmp, 'missing.toml'),
    '--llm-api', 'available'
  ]);
  assert.strictEqual(missingFile.status, 1);
  assert.match(missingFile.stderr, /Error: LLM config file not found:/);

  const malformed = path.join(tmp, 'malformed.toml');
  fs.writeFileSync(malformed, '[[llm_api]\nname = "broken"\n');
  const malformedResult = run(['--llm-config', malformed, '--llm-api', 'broken']);
  assert.strictEqual(malformedResult.status, 1);
  assert.match(malformedResult.stderr, /Error: failed to parse LLM config file:/);

  console.log('llm-config CLI tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
