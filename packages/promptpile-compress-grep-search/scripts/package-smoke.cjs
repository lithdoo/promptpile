const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcgs-package-smoke-'));

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || packageRoot,
    encoding: 'utf8',
    windowsHide: true,
    shell: options.shell === true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`
    );
  }
  return result;
};

try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm_execpath is unavailable');
  const npm = (args, options) =>
    run(process.execPath, [npmCli, ...args], options);
  const packed = npm([
    'pack',
    '--json',
    '--pack-destination',
    root,
  ]);
  const metadata = JSON.parse(packed.stdout)[0];
  const paths = metadata.files.map((file) => file.path);
  const required = [
    'dist/cli-entry.js',
    'dist/cli.js',
    'dist/index.js',
    'dist/index.d.ts',
    'LICENSE',
    'README.md',
    'package.json',
  ];
  for (const name of required) {
    if (!paths.includes(name)) throw new Error(`packed file missing: ${name}`);
  }
  if (paths.some((name) => name.startsWith('src/') || name.includes('.test.'))) {
    throw new Error('packed artifact contains source or test files');
  }

  const consumer = path.join(root, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'ppcgs-smoke-consumer', private: true })
  );
  const tarball = path.join(root, metadata.filename);
  npm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      tarball,
    ],
    { cwd: consumer }
  );

  const bin = path.join(
    consumer,
    'node_modules',
    '.bin',
    process.platform === 'win32'
      ? 'promptpile-archive.cmd'
      : 'promptpile-archive'
  );
  if (!fs.existsSync(bin)) throw new Error(`installed bin missing: ${bin}`);
  const help = run(bin, ['--help'], {
    cwd: consumer,
    shell: process.platform === 'win32',
  });
  if (!help.stdout.includes('promptpile-archive search')) {
    throw new Error('installed CLI help is invalid');
  }
  const messages = path.join(consumer, 'messages');
  const archive = path.join(messages, '[1]system.md.archive');
  fs.mkdirSync(archive, { recursive: true });
  fs.writeFileSync(
    path.join(archive, 'compression.json'),
    JSON.stringify({ version: 1, archivedTurnIndices: [1] })
  );
  fs.writeFileSync(path.join(archive, '[1]user.md'), 'installed smoke-needle');
  const search = run(
    bin,
    ['search', '-d', messages, 'smoke-needle', '--json'],
    { cwd: consumer, shell: process.platform === 'win32' }
  );
  const searchResult = JSON.parse(search.stdout);
  if (!searchResult.ok || searchResult.data.results[0]?.turnIdx !== 1) {
    throw new Error('installed CLI search result is invalid');
  }
  const api = require(path.join(
    consumer,
    'node_modules',
    'promptpile-compress-grep-search'
  ));
  if (typeof api.searchArchive !== 'function') {
    throw new Error('installed package does not export searchArchive');
  }
  console.log(
    JSON.stringify({
      packageSmoke: 'passed',
      packedFiles: paths.length,
      unpackedSize: metadata.unpackedSize,
      externalSearchBinaries: 0,
    })
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
