const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveAfterHookScript } = require('../dist/after-hook.js');
const { resolveConfig } = require('../dist/resolve-config.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-hook-security-'));
try {
  const scanAbs = path.join(root, 'messages');
  fs.mkdirSync(scanAbs);
  const defaultName = process.platform === 'win32' ? '.after-hook.cmd' : '.after-hook.sh';
  const defaultPath = path.join(scanAbs, defaultName);
  fs.writeFileSync(defaultPath, 'echo ok\n');

  assert.deepStrictEqual(
    resolveAfterHookScript({ cwd: root, scanAbs }),
    { status: 'skip' },
    'default hook discovery must be disabled without CLI opt-in'
  );

  const allowedDefault = resolveAfterHookScript({
    cwd: root,
    scanAbs,
    allowDefaultAfterHook: true,
  });
  assert.strictEqual(allowedDefault.status, 'run');
  assert.strictEqual(allowedDefault.path, fs.realpathSync(defaultPath));

  const explicitPath = path.join(root, 'explicit.sh');
  fs.writeFileSync(explicitPath, 'echo explicit\n');
  const explicitCli = resolveAfterHookScript({
    cwd: root,
    scanAbs,
    afterHookCli: './explicit.sh',
  });
  assert.strictEqual(explicitCli.status, 'run');
  assert.strictEqual(explicitCli.path, fs.realpathSync(explicitPath));

  const configuredPath = path.join(scanAbs, 'configured.sh');
  fs.writeFileSync(configuredPath, 'echo configured\n');
  const explicitConfig = resolveAfterHookScript({
    cwd: root,
    scanAbs,
    afterHookConfig: './configured.sh',
  });
  assert.strictEqual(explicitConfig.status, 'run');
  assert.strictEqual(explicitConfig.path, fs.realpathSync(configuredPath));

  const directoryResult = resolveAfterHookScript({
    cwd: root,
    scanAbs,
    afterHookCli: scanAbs,
  });
  assert.strictEqual(directoryResult.status, 'warn_invalid_explicit');
  assert.match(directoryResult.reason, /regular file/);

  if (process.platform !== 'win32') {
    const linkPath = path.join(root, 'hook-link.sh');
    fs.symlinkSync(explicitPath, linkPath);
    const linked = resolveAfterHookScript({
      cwd: root,
      scanAbs,
      afterHookCli: linkPath,
    });
    assert.strictEqual(linked.status, 'run');
    assert.strictEqual(linked.path, fs.realpathSync(explicitPath));
  }

  const configPath = path.join(root, 'promptpile.toml');
  fs.writeFileSync(
    configPath,
    '[promptpile]\ndir = "./messages"\nallow_default_after_hook = true\n'
  );
  const fromToml = resolveConfig(root, ['node', 'promptpile', '--config', configPath]);
  assert.strictEqual(fromToml.allowDefaultAfterHook, false, 'TOML must not enable default hooks');
  const fromCli = resolveConfig(root, [
    'node',
    'promptpile',
    '--config',
    configPath,
    '--allow-default-after-hook',
  ]);
  assert.strictEqual(fromCli.allowDefaultAfterHook, true);

  console.log('after-hook security tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
