'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { parseCli } = require(path.join(root, 'dist', 'cli.js'));
const { loadConfig } = require(path.join(root, 'dist', 'config.js'));
const { resolveConfig } = require(path.join(root, 'dist', 'resolve-config.js'));
const {
  buildMessagesWithDiagnostics,
  scanDirectory
} = require(path.join(root, 'dist', 'file-handler.js'));
const {
  applyAppendFiles,
  applyInsertFiles,
  loadSidecarMessages
} = require(path.join(root, 'dist', 'message-sidecar-files.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-layered-'));
try {
  const base = path.join(tmp, 'base');
  const shared = path.join(tmp, 'shared');
  fs.mkdirSync(base);
  fs.mkdirSync(shared);

  fs.writeFileSync(path.join(base, '[0]system.md'), 'base-system');
  fs.writeFileSync(path.join(base, '[1]assistant.md'), 'base-assistant');
  fs.writeFileSync(
    path.join(base, '[1]assistant.calls.jsonl'),
    `${JSON.stringify({
      id: 'same-call-id',
      type: 'function',
      function: { name: 'base_tool', arguments: '{}' }
    })}\n`
  );
  fs.writeFileSync(path.join(shared, '[0]system.md'), 'shared-system');
  fs.writeFileSync(
    path.join(shared, '[1]assistant.result.jsonl'),
    `${JSON.stringify({ tool_call_id: 'same-call-id', content: 'must-stay-shared' })}\n`
  );

  const parsed = parseCli([
    'node',
    'promptpile',
    '-d',
    base,
    '--directory',
    shared
  ]);
  assert.deepStrictEqual(
    parsed.options.inputDirectories,
    [base, shared],
    'repeated CLI directories preserve argv order'
  );
  const parsedOutput = parseCli([
    'node',
    'promptpile',
    '-d',
    base,
    '--output-dir',
    shared
  ]);
  assert.strictEqual(parsedOutput.options.outputDirectory, shared);
  const manuallyLoaded = loadConfig({
    inputDirectories: [base, shared],
    outputDirectory: base
  });
  assert.deepStrictEqual(manuallyLoaded.inputDirectories, [shared, base]);
  assert.strictEqual(manuallyLoaded.directory, base);

  const cliConfig = resolveConfig(tmp, [
    'node',
    'promptpile',
    '-d',
    base,
    '-d',
    shared,
    '-d',
    path.join(base, '.'),
    '--disable-tool'
  ]);
  assert.deepStrictEqual(
    cliConfig.inputDirectories,
    [fs.realpathSync(base), fs.realpathSync(shared)],
    'canonical duplicate inputs are removed while first occurrence order is retained'
  );
  assert.strictEqual(
    cliConfig.directory,
    fs.realpathSync(shared),
    'compatibility anchor is the final effective input layer'
  );

  const baseAlias = path.join(tmp, 'base-alias');
  let aliasCreated = false;
  try {
    fs.symlinkSync(base, baseAlias, process.platform === 'win32' ? 'junction' : 'dir');
    aliasCreated = true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  }
  if (aliasCreated) {
    const symlinkConfig = resolveConfig(tmp, [
      'node',
      'promptpile',
      '-d',
      baseAlias,
      '-d',
      base,
      '--output-dir',
      shared,
      '--continue'
    ]);
    assert.deepStrictEqual(
      symlinkConfig.inputDirectories,
      [fs.realpathSync(base), fs.realpathSync(shared)],
      'directory symlink aliases collapse to one canonical input identity'
    );
  }

  const platformRelativeAlias = process.platform === 'win32'
    ? '.\\base\\..\\base'
    : './base/../base';
  const relativeConfig = resolveConfig(tmp, [
    'node',
    'promptpile',
    '-d',
    platformRelativeAlias,
    '-d',
    './shared',
    '--disable-tool'
  ]);
  assert.deepStrictEqual(
    relativeConfig.inputDirectories,
    [fs.realpathSync(base), fs.realpathSync(shared)],
    `${process.platform} relative path segments resolve to stable layer identities`
  );

  if (process.platform === 'win32') {
    const caseAliasConfig = resolveConfig(tmp, [
      'node',
      'promptpile',
      '-d',
      base,
      '-d',
      base.toUpperCase(),
      '--disable-tool'
    ]);
    assert.deepStrictEqual(
      caseAliasConfig.inputDirectories,
      [fs.realpathSync(base)],
      'Windows directory identity comparison is case-insensitive'
    );
  }

  const outputOnly = path.join(tmp, 'output-only');
  const outputOnlyConfig = resolveConfig(tmp, [
    'node',
    'promptpile',
    '--output-dir',
    outputOnly,
    '--disable-tool'
  ]);
  assert.ok(fs.statSync(outputOnly).isDirectory(), 'a missing output directory is created');
  assert.strictEqual(outputOnlyConfig.outputDirectory, fs.realpathSync(outputOnly));
  assert.deepStrictEqual(
    outputOnlyConfig.inputDirectories,
    [fs.realpathSync(outputOnly)],
    'output-only configuration does not synthesize the default messages directory'
  );

  const movedOutputConfig = resolveConfig(tmp, [
    'node',
    'promptpile',
    '-d',
    shared,
    '-d',
    base,
    '--output-dir',
    path.join(shared, '.'),
    '--continue'
  ]);
  assert.deepStrictEqual(
    movedOutputConfig.inputDirectories,
    [fs.realpathSync(base), fs.realpathSync(shared)],
    'an output alias is removed from its old position and appended exactly once'
  );
  assert.strictEqual(movedOutputConfig.outputDirectory, fs.realpathSync(shared));
  assert.strictEqual(movedOutputConfig.directory, fs.realpathSync(shared));

  const singleMutation = resolveConfig(tmp, [
    'node',
    'promptpile',
    '-d',
    base,
    '--continue'
  ]);
  assert.strictEqual(
    singleMutation.outputDirectory,
    fs.realpathSync(base),
    'single-directory mutation keeps the legacy implicit write target'
  );

  const configPath = path.join(tmp, 'promptpile.toml');
  fs.writeFileSync(
    configPath,
    `[promptpile]\ndirs = ["./base", "./shared"]\ndisable_tool = true\n`
  );
  const tomlConfig = resolveConfig(tmp, [
    'node',
    'promptpile',
    '--config',
    configPath
  ]);
  assert.deepStrictEqual(
    tomlConfig.inputDirectories,
    [fs.realpathSync(base), fs.realpathSync(shared)],
    'TOML dirs preserve declared order'
  );

  const tomlOutput = path.join(tmp, 'toml-output');
  fs.writeFileSync(
    configPath,
    `[promptpile]\ndirs = ["./base"]\noutput_dir = "./toml-output"\ndisable_tool = true\n`
  );
  const tomlOutputConfig = resolveConfig(tmp, [
    'node',
    'promptpile',
    '--config',
    configPath
  ]);
  assert.strictEqual(tomlOutputConfig.outputDirectory, fs.realpathSync(tomlOutput));
  assert.deepStrictEqual(
    tomlOutputConfig.inputDirectories,
    [fs.realpathSync(base), fs.realpathSync(tomlOutput)]
  );
  const cliOutput = path.join(tmp, 'cli-output');
  const cliOutputOverride = resolveConfig(tmp, [
    'node',
    'promptpile',
    '--config',
    configPath,
    '--output-dir',
    cliOutput
  ]);
  assert.strictEqual(
    cliOutputOverride.outputDirectory,
    fs.realpathSync(cliOutput),
    'CLI output directory overrides TOML output_dir'
  );
  assert.deepStrictEqual(
    cliOutputOverride.inputDirectories,
    [fs.realpathSync(base), fs.realpathSync(cliOutput)]
  );

  fs.writeFileSync(
    configPath,
    `[promptpile]\ndirs = ["./base", "./shared"]\ndisable_tool = true\n`
  );
  const cliOverride = resolveConfig(tmp, [
    'node',
    'promptpile',
    '--config',
    configPath,
    '-d',
    shared
  ]);
  assert.deepStrictEqual(
    cliOverride.inputDirectories,
    [fs.realpathSync(shared)],
    'CLI directory array replaces the TOML array as one precedence layer'
  );

  const invalidOutputFile = path.join(tmp, 'not-an-output-directory');
  fs.writeFileSync(invalidOutputFile, 'file');
  assert.throws(
    () => resolveConfig(tmp, [
      'node',
      'promptpile',
      '-d',
      base,
      '--output-dir',
      invalidOutputFile
    ]),
    /cannot create, scan, or write conversation output directory/,
    'an output path that is a regular file fails during preflight'
  );

  fs.writeFileSync(
    configPath,
    `[promptpile]\ndir = "./base"\ndirs = ["./shared"]\n`
  );
  assert.throws(
    () => resolveConfig(tmp, ['node', 'promptpile', '--config', configPath]),
    /dirs and promptpile\.dir cannot be used together/,
    'TOML dir and dirs are mutually exclusive'
  );

  fs.writeFileSync(configPath, '[promptpile]\ndirs = []\n');
  assert.throws(
    () => resolveConfig(tmp, ['node', 'promptpile', '--config', configPath]),
    /dirs must be a non-empty array/,
    'TOML dirs rejects an empty array'
  );

  assert.throws(
    () => resolveConfig(tmp, [
      'node',
      'promptpile',
      '-d',
      base,
      '-d',
      shared,
      '--continue'
    ]),
    /multiple conversation input directories cannot be used.*--output-dir/,
    'layered mutation requires an explicit output directory'
  );
  assert.throws(
    () => resolveConfig(tmp, [
      'node',
      'promptpile',
      '-d',
      base,
      '-d',
      shared,
      '--input'
    ]),
    /multiple conversation input directories cannot be used.*--output-dir/,
    'interactive user mutation is also rejected for layered input'
  );

  fs.writeFileSync(
    configPath,
    `[promptpile]\ndirs = ["./base", "./shared"]\ncontinue = true\n`
  );
  assert.throws(
    () => resolveConfig(tmp, ['node', 'promptpile', '--config', configPath]),
    /multiple conversation input directories cannot be used.*--output-dir/,
    'TOML mutation flags use the same layered validation'
  );

  const files = [
    ...scanDirectory(base, 0),
    ...scanDirectory(shared, 1)
  ];
  assert.deepStrictEqual(
    files.map(file => [file.directoryIndex, file.relativePath]),
    [
      [0, '[0]system.md'],
      [0, '[1]assistant.md'],
      [0, '[1]assistant.calls.jsonl'],
      [1, '[0]system.md'],
      [1, '[1]assistant.result.jsonl']
    ],
    'scanned artifacts retain layer-qualified identity'
  );

  const built = buildMessagesWithDiagnostics(files);
  assert.deepStrictEqual(
    built.messages.map(message => [message.role, message.content]),
    [
      ['system', 'base-system'],
      ['assistant', 'base-assistant'],
      ['tool', '错误：未在 [1]assistant.result.jsonl 中找到 tool_call_id=same-call-id'],
      ['system', 'shared-system'],
      ['tool', 'must-stay-shared']
    ],
    'layers concatenate without globally interleaving equal idx values'
  );
  assert.strictEqual(built.diagnostics.length, 1);
  assert.strictEqual(built.diagnostics[0].directoryIndex, 0);
  assert.strictEqual(
    path.dirname(built.diagnostics[0].resultPath),
    base,
    'a result in another layer never satisfies a calls artifact'
  );

  const insertPath = path.join(tmp, 'before.system.md');
  const appendPath = path.join(tmp, 'after.user.md');
  fs.writeFileSync(insertPath, 'before-all-layers');
  fs.writeFileSync(appendPath, 'after-all-layers');
  const withInsert = applyInsertFiles(
    built.messages,
    loadSidecarMessages(tmp, insertPath)
  );
  const withBoth = applyAppendFiles(
    withInsert,
    loadSidecarMessages(tmp, appendPath)
  );
  assert.strictEqual(withBoth[0].content, 'before-all-layers');
  assert.strictEqual(withBoth.at(-1).content, 'after-all-layers');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('layered conversation Phase 1 tests ok');
