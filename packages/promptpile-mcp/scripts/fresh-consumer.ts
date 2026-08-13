import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function runProcess(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

export type FreshConsumer = {
  root: string;
  binDirectory: string;
  cleanup: () => void;
};

export function createFreshConsumer(repositoryRoot: string): FreshConsumer {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-mcp-packed-'));
  try {
    for (const packageName of ['promptpile-protocol', 'promptpile', 'promptpile-mcp']) {
      runProcess(
        npm,
        ['pack', path.join(repositoryRoot, 'packages', packageName), '--pack-destination', root],
        repositoryRoot
      );
    }
    const tarballs = fs.readdirSync(root)
      .filter((file) => file.endsWith('.tgz'))
      .map((file) => path.join(root, file));
    if (tarballs.length !== 3) throw new Error(`expected 3 tarballs, found ${tarballs.length}`);
    runProcess(npm, ['init', '-y'], root);
    runProcess(npm, ['install', '--ignore-scripts', ...tarballs], root);
    return {
      root,
      binDirectory: path.join(root, 'node_modules', '.bin'),
      cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
