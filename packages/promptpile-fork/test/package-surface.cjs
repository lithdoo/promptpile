'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const packageRoot = path.join(__dirname, '..');
const protocolRoot = path.join(packageRoot, '..', 'promptpile-protocol');
const npmCli = process.env.npm_execpath;
assert(npmCli, 'npm_execpath must be available under npm test');
const pack = root => JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))[0];
const forkPack = pack(packageRoot); const protocolPack = pack(protocolRoot);
const forkTarball = path.join(packageRoot, forkPack.filename); const protocolTarball = path.join(protocolRoot, protocolPack.filename);
const files = forkPack.files.map(item => item.path);
assert(files.includes('dist/index.js')); assert(files.includes('dist/operation.js'));
assert(!files.some(file => file.startsWith('src/') || file.startsWith('test/')));
const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fork-pack-'));
try {
  execFileSync(process.execPath, [npmCli, 'init', '-y'], { cwd: installRoot, stdio: 'ignore' });
  execFileSync(process.execPath, [npmCli, 'install', '--ignore-scripts', protocolTarball, forkTarball], { cwd: installRoot, stdio: 'ignore' });
  const binary = path.join(installRoot, 'node_modules', 'promptpile-fork', 'dist', 'index.js');
  const help = execFileSync(process.execPath, [binary, '--help'], { cwd: installRoot, encoding: 'utf8' });
  assert.match(help, /--through-index/);
  const source = path.join(installRoot, 'source'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, '[0]user.md'), 'packed');
  execFileSync(process.execPath, [binary, '--source', source, '--target', path.join(installRoot, 'target'), '--through-index', '0'], { cwd: installRoot });
  assert.strictEqual(fs.readFileSync(path.join(installRoot, 'target', '[0]user.md'), 'utf8'), 'packed');
} finally {
  fs.rmSync(installRoot, { recursive: true, force: true });
  fs.unlinkSync(forkTarball); fs.unlinkSync(protocolTarball);
}
console.log('fork packed tarball surface and install smoke ok');
