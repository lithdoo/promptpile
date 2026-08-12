'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const cli = path.join(__dirname, '..', 'dist', 'index.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-strict-toml-'));
const config = path.join(root, 'config.toml');

try {
  const cases = [
    ['[promptpile]\ncontinue = "tru"\n', /continue must be a TOML boolean/],
    ['[promptpile]\ntools_file = 123\n', /tools_file must be a TOML string/],
    ['[promptpile]\noutput = 123\n', /output must be a TOML string/],
    ['[promptpile]\noutput = true\n', /output must be a TOML string/],
    ['[promptpile]\nllm_api_temperature = "0.5"\n', /temperature must be a TOML number/],
    ['[promptpile]\nllm_api_extra_body = "{}"\n', /extra_body must be a TOML table/],
    ['[promptpile]\nmodell = "typo"\n', /unknown \[promptpile\] key: modell/],
    ['[[llm_api]]\nname = "x"\nmodell = "typo"\n', /unknown \[\[llm_api\]\] key/],
    ['promptpile = "invalid"\n', /promptpile must be a TOML table/],
    ['llm_api = "invalid"\n', /llm_api must be an array of TOML tables/],
    ['[[llm_api]]\nname = "Prod"\n[[llm_api]]\nname = "prod"\n', /duplicate case-insensitive llm_api profile name/]
  ];
  for (const [source, expected] of cases) {
    fs.writeFileSync(config, source);
    const result = spawnSync(process.execPath, [cli, '--config', config], {
      cwd: root, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' }
    });
    assert.strictEqual(result.status, 1, result.stderr);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /AI API key is required/);
  }
  console.log('strict-toml-types.cjs: ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
