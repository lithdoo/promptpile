const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildPromptpileHookEnv, resolveAfterHookScript } = require('../dist/after-hook.js');
const { CompletionArtifactLedger } = require('../dist/completion-artifact-ledger.js');
const { resolveConfig } = require('../dist/resolve-config.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-hook-security-'));
const previousFailureEnv = process.env.PROMPTPILE_AFTER_HOOK_FAILURE;
try {
  process.env.PROMPTPILE_AFTER_HOOK_FAILURE = 'error';
  const scanAbs = path.join(root, 'messages');
  fs.mkdirSync(scanAbs);
  const defaultName = process.platform === 'win32' ? '.after-hook.cmd' : '.after-hook.sh';
  const defaultPath = path.join(scanAbs, defaultName);
  fs.writeFileSync(defaultPath, 'echo ok\n');

  assert.deepStrictEqual(
    resolveAfterHookScript({ cwd: root, scanAbs }),
    { status: 'skip', reason: 'not_configured' },
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
  assert.strictEqual(directoryResult.status, 'invalid_explicit');
  assert.match(directoryResult.reason, /regular file/);
  const invalidCliDoesNotFallback = resolveAfterHookScript({
    cwd: root,
    scanAbs,
    afterHookCli: './missing-cli-hook.sh',
    afterHookConfig: './configured.sh',
    allowDefaultAfterHook: true
  });
  assert.strictEqual(invalidCliDoesNotFallback.status, 'invalid_explicit');
  assert.match(invalidCliDoesNotFallback.attempted, /missing-cli-hook/);

  const noDefaultDirectory = path.join(root, 'no-default');
  fs.mkdirSync(noDefaultDirectory);
  assert.deepStrictEqual(resolveAfterHookScript({
    cwd: root,
    scanAbs: noDefaultDirectory,
    allowDefaultAfterHook: true
  }), { status: 'skip', reason: 'default_not_found' });

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
  assert.strictEqual(fromToml.afterHookFailure, 'warn', 'failure mode is not read from process env');
  const fromCli = resolveConfig(root, [
    'node',
    'promptpile',
    '--config',
    configPath,
    '--allow-default-after-hook',
  ]);
  assert.strictEqual(fromCli.allowDefaultAfterHook, true);
  assert.strictEqual(fromCli.afterHookFailure, 'warn');
  fs.writeFileSync(
    configPath,
    '[promptpile]\ndir = "./messages"\nafter_hook_failure = "error"\n'
  );
  const failureFromToml = resolveConfig(root, ['node', 'promptpile', '--config', configPath]);
  assert.strictEqual(failureFromToml.afterHookFailure, 'error');
  const failureFromCli = resolveConfig(root, [
    'node', 'promptpile', '--config', configPath, '--after-hook-failure', 'warn'
  ]);
  assert.strictEqual(failureFromCli.afterHookFailure, 'warn');
  fs.writeFileSync(
    configPath,
    '[promptpile]\ndir = "./messages"\nllm_api = "profile"\n\n' +
      '[[llm_api]]\nname = "profile"\nafter_hook_failure = "error"\n'
  );
  const failureNotFromProfile = resolveConfig(root, ['node', 'promptpile', '--config', configPath]);
  assert.strictEqual(failureNotFromProfile.afterHookFailure, 'warn');
  fs.writeFileSync(
    configPath,
    '[promptpile]\ndir = "./messages"\nafter_hook_failure = "WARN"\n'
  );
  assert.throws(
    () => resolveConfig(root, ['node', 'promptpile', '--config', configPath]),
    /invalid after-hook failure mode/
  );

  const outputAbs = path.join(root, 'output');
  const layeredLedger = new CompletionArtifactLedger();
  layeredLedger.record({
    namespace: 'conversation',
    kind: 'body',
    absolutePath: path.join(outputAbs, '[1]assistant.md')
  });
  const layeredEnv = buildPromptpileHookEnv({
    scanAbs: outputAbs,
    inputDirectories: [scanAbs, outputAbs],
    outputDirectory: outputAbs,
    ledger: layeredLedger,
    toolCalls: undefined,
    model: 'test-model',
    quiet: true,
    responseLength: 2
  });
  assert.strictEqual(layeredEnv.PROMPTPILE_SCAN_DIRECTORY, '');
  assert.deepStrictEqual(
    JSON.parse(layeredEnv.PROMPTPILE_INPUT_DIRECTORIES_JSON),
    [scanAbs, outputAbs]
  );
  assert.strictEqual(layeredEnv.PROMPTPILE_OUTPUT_DIRECTORY, outputAbs);
  assert.strictEqual(
    layeredEnv.PROMPTPILE_ASSISTANT_MD_FILE,
    path.join(outputAbs, '[1]assistant.md')
  );

  const singleLedger = new CompletionArtifactLedger();
  const singleEnv = buildPromptpileHookEnv({
    scanAbs,
    inputDirectories: [scanAbs],
    outputDirectory: scanAbs,
    ledger: singleLedger,
    toolCalls: undefined,
    model: 'test-model',
    quiet: false,
    responseLength: 0
  });
  assert.strictEqual(
    singleEnv.PROMPTPILE_SCAN_DIRECTORY,
    scanAbs,
    'the legacy scan variable remains available in single-layer mode'
  );

  console.log('after-hook security tests passed');
} finally {
  if (previousFailureEnv === undefined) delete process.env.PROMPTPILE_AFTER_HOOK_FAILURE;
  else process.env.PROMPTPILE_AFTER_HOOK_FAILURE = previousFailureEnv;
  fs.rmSync(root, { recursive: true, force: true });
}
