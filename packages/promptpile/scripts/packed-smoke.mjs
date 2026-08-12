import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, '..');
const protocolRoot = path.resolve(packageRoot, '..', 'promptpile-protocol');
const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const protocolMetadata = JSON.parse(fs.readFileSync(path.join(protocolRoot, 'package.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-packed-smoke-'));
const run = (command, args, cwd) => spawnSync(command, args, {
  cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, NODE_NO_WARNINGS: '1' }
});

try {
  const packedProtocol = run('npm', ['pack', '--json'], protocolRoot);
  assert.strictEqual(packedProtocol.status, 0, packedProtocol.stderr);
  const protocolArchiveName = JSON.parse(packedProtocol.stdout)[0].filename;
  const protocolArchivePath = path.join(protocolRoot, protocolArchiveName);
  const packed = run('npm', ['pack', '--json'], packageRoot);
  assert.strictEqual(packed.status, 0, packed.stderr);
  const archiveName = JSON.parse(packed.stdout)[0].filename;
  const archivePath = path.join(packageRoot, archiveName);
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"private":true}\n');
  const installed = run(
    'npm',
    ['install', '--ignore-scripts', protocolArchivePath, archivePath],
    tempRoot
  );
  assert.strictEqual(installed.status, 0, installed.stderr);
  const executable = path.join(tempRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'promptpile.cmd' : 'promptpile');
  const version = run(executable, ['--version'], tempRoot);
  assert.strictEqual(version.status, 0, version.stderr);
  assert.strictEqual(version.stdout.trim(), metadata.version);
  const help = run(executable, ['--help'], tempRoot);
  assert.strictEqual(help.status, 0, help.stderr);
  assert.match(help.stdout, /Assemble message files and call Chat Completions APIs/);
  console.log('packed-smoke.mjs: ok');
} finally {
  fs.rmSync(path.join(packageRoot, `promptpile-${metadata.version}.tgz`), { force: true });
  fs.rmSync(
    path.join(protocolRoot, `promptpile-protocol-${protocolMetadata.version}.tgz`),
    { force: true }
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
