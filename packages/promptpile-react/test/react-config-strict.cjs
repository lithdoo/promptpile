'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { buildReactOnlyTomlLayer, buildSharedTomlLayer, loadReactTomlConfig } = require(path.join(root, 'dist', 'toml-config-react.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-strict-config-'));
const load = body => {
  const file = path.join(tmp, 'config.toml');
  fs.writeFileSync(file, body);
  return loadReactTomlConfig(file);
};

try {
  assert.throws(() => load('[promptpile-react]\nmax_steps = 2\n'), /unknown.*max_steps/i);
  assert.throws(() => buildSharedTomlLayer(load('[promptpile-react]\ncontinue = "true"\n').promptpileReact), /continue must be a boolean/i);
  assert.throws(() => buildSharedTomlLayer(load('[promptpile-react]\ndir = 123\n').promptpileReact), /dir must be a string/i);
  assert.throws(() => buildReactOnlyTomlLayer(load('[promptpile-react]\nmax_step = "3"\n').promptpileReact), /max_step must be an integer/i);
  assert.throws(() => buildReactOnlyTomlLayer(load('[promptpile-react]\nwork_root = 3\n').promptpileReact), /work_root must be a string/i);
  assert.throws(() => buildReactOnlyTomlLayer(load('[promptpile-react]\nthought_llm_api_model = 123\n').promptpileReact), /thought_llm_api_model must be a string/i);
  assert.throws(() => buildReactOnlyTomlLayer(load('[promptpile-react]\nthought_llm_api_extra_body = []\n').promptpileReact), /must be a TOML table/i);

  const futurePromptpile = load('[promptpile]\nfuture_valid_key = "owned by Promptpile"\n');
  assert.strictEqual(buildSharedTomlLayer(futurePromptpile.promptpile).quiet, undefined);

  const delegatedProfiles = load('[[llm_api]]\nname = 123\n[promptpile-react]\nmax_step = 1\n');
  assert.strictEqual(buildReactOnlyTomlLayer(delegatedProfiles.promptpileReact).maxStep, 1);

  console.log('promptpile-react strict config tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
