import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_VERSION } from '../src/version';
import { runCompositionWitness } from './composition-witness';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-mcp-packed-'));
function run(command: string, args: string[], cwd = temp): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

async function main(): Promise<void> {
try {
  const repo = path.resolve(__dirname, '../../../..');
  run(npm, ['pack', path.join(repo, 'packages/promptpile-protocol'), '--pack-destination', temp], repo);
  run(npm, ['pack', path.join(repo, 'packages/promptpile'), '--pack-destination', temp], repo);
  run(npm, ['pack', path.join(repo, 'packages/promptpile-mcp'), '--pack-destination', temp], repo);
  const tarballs = fs.readdirSync(temp).filter((file) => file.endsWith('.tgz')).map((file) => path.join(temp, file));
  assert.equal(tarballs.length, 3);
  run(npm, ['init', '-y']);
  run(npm, ['install', '--ignore-scripts', ...tarballs]);
  const bin = path.join(temp, 'node_modules', '.bin', process.platform === 'win32' ? 'promptpile-mcp.cmd' : 'promptpile-mcp');
  assert.equal(run(bin, ['--version']), PACKAGE_VERSION);
  assert.match(run(bin, ['--help']), /exec-calls/);
  await runCompositionWitness(path.join(temp, 'node_modules', '.bin'));
  console.log('packed smoke: ok');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
