import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(reactRoot, '..', '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-react-packed-'));
const archives = path.join(tempRoot, 'archives');
const consumer = path.join(tempRoot, 'consumer');
fs.mkdirSync(archives);
fs.mkdirSync(consumer);

const npmCli = process.env.npm_execpath;
const runNpm = (args, cwd = repoRoot) => {
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed:\n${result.stderr || result.error?.message}`);
  }
  return result.stdout;
};

try {
  for (const packageName of ['promptpile-protocol', 'promptpile', 'promptpile-react']) {
    runNpm(['pack', path.join(repoRoot, 'packages', packageName), '--pack-destination', archives]);
  }

  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true }));
  const tarballs = fs.readdirSync(archives).map(file => path.join(archives, file));
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], consumer);

  const installedRoot = path.join(consumer, 'node_modules', 'promptpile-react');
  const cli = path.join(installedRoot, 'dist', 'index.js');
  const metadata = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
  if (!fs.existsSync(path.join(installedRoot, 'schema', 'agent-event-v1.schema.json'))) {
    throw new Error('packed artifact is missing schema/agent-event-v1.schema.json');
  }
  const invoke = args => spawnSync(process.execPath, [cli, ...args], { cwd: consumer, encoding: 'utf8' });

  const help = invoke(['--help']);
  if (help.status !== 0 || !help.stdout.includes('promptpile-react')) {
    throw new Error(`packed --help failed:\n${help.stderr}`);
  }
  const version = invoke(['--version']);
  if (version.status !== 0 || version.stdout.trim() !== metadata.version) {
    throw new Error(`packed --version mismatch: ${version.stdout}${version.stderr}`);
  }
  if ('main' in metadata) {
    throw new Error('packed package unexpectedly exposes a library main');
  }
  for (const buildOnly of ['typescript', '@types/node']) {
    if (metadata.dependencies?.[buildOnly] !== undefined) {
      throw new Error(`packed runtime dependency contains ${buildOnly}`);
    }
  }

  const messages = path.join(consumer, 'messages');
  fs.mkdirSync(messages);
  fs.writeFileSync(path.join(messages, '[0]user.md'), 'packed smoke');
  const fake = path.join(consumer, 'node_modules', 'promptpile', 'dist', 'index.js');
  fs.writeFileSync(fake, [
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "const outputIndex = argv.indexOf('-o');",
    'if (outputIndex >= 0) {',
    '  const output = argv[outputIndex + 1];',
    "  fs.writeFileSync(output, 'phase output');",
    "  if (argv.includes('--tool-choice')) {",
    '    const parsed = path.parse(output);',
    '    const calls = path.join(parsed.dir, `${parsed.name}.calls.jsonl`);',
    '    const call = { id: "packed-check", type: "function", function: { name: "react_check_decision", arguments: "{\\"decision\\":false}" } };',
    '    fs.writeFileSync(calls, JSON.stringify(call) + "\\n");',
    '  }',
    '}',
    "const fdIndex = argv.indexOf('--output-pile-fd');",
    'if (fdIndex >= 0) {',
    "  const stream = fs.createWriteStream('', { fd: Number(argv[fdIndex + 1]), encoding: 'utf8' });",
    "  stream.write(JSON.stringify({ type: 'assistant_delta', content: 'packed final' }) + '\\n');",
    "  stream.end(JSON.stringify({ type: 'assistant_done' }) + '\\n');",
    '}'
  ].join('\n'));
  const smoke = spawnSync(process.execPath, [cli, '-d', messages], {
    cwd: consumer,
    encoding: 'utf8',
    env: { ...process.env, PROMPTPILE_BIN: '' }
  });
  if (smoke.status !== 0) {
    throw new Error(`packed orchestration smoke failed (status=${smoke.status}, error=${smoke.error?.message ?? 'none'}):\nstdout=${smoke.stdout}\nstderr=${smoke.stderr}`);
  }

  const finalPrompt = path.join(messages, 'final.md');
  const reactConfig = path.join(consumer, 'react.toml');
  fs.writeFileSync(finalPrompt, 'final instructions');
  fs.writeFileSync(reactConfig, `[promptpile-react]\ndirs=["${messages.replace(/\\/g, '\\\\')}"]\nfinal_prompt="final.md"\n`);
  const streaming = spawnSync(process.execPath, [cli, '--config', reactConfig, '--output-format', 'stream-json'], {
    cwd: consumer,
    encoding: 'utf8',
    env: { ...process.env, PROMPTPILE_BIN: '' }
  });
  if (streaming.status !== 0) {
    throw new Error(`packed streaming smoke failed:\nstdout=${streaming.stdout}\nstderr=${streaming.stderr}`);
  }
  const events = streaming.stdout.trim().split(/\r?\n/).map(JSON.parse);
  if (events[0]?.type !== 'session.started' || events.at(-1)?.type !== 'session.completed') {
    throw new Error(`packed streaming smoke emitted an invalid trace: ${streaming.stdout}`);
  }

  console.log('promptpile-react packed artifact smoke ok');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
