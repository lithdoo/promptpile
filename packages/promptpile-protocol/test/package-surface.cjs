'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const packageRoot = path.join(__dirname, '..');
const npmCli = process.env.npm_execpath;
assert(npmCli, 'npm_execpath must be available under npm test');
const output = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts'], { cwd: packageRoot, encoding: 'utf8' }));
const files = output[0].files.map(item => item.path);
assert(files.includes('dist/conversation.js'));
assert(files.includes('dist/conversation.d.ts'));
assert(files.includes('dist/schemas/completion-receipt-v1.json'));
assert(!files.some(file => file.startsWith('src/') || file.startsWith('test/') || file.endsWith('.map')));
const tarball = path.join(packageRoot, output[0].filename);
const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-protocol-pack-'));
try {
  execFileSync(process.execPath, [npmCli, 'init', '-y'], { cwd: installRoot, stdio: 'ignore' });
  execFileSync(process.execPath, [npmCli, 'install', '--ignore-scripts', tarball], { cwd: installRoot, stdio: 'ignore' });
  execFileSync(process.execPath, ['-e', "require('promptpile-protocol'); require('promptpile-protocol/conversation'); require('promptpile-protocol/tool'); require('promptpile-protocol/receipt'); require('promptpile-protocol/schemas/completion-receipt-v1.json')"], { cwd: installRoot, stdio: 'pipe' });
} finally {
  fs.rmSync(installRoot, { recursive: true, force: true });
  fs.unlinkSync(tarball);
}
