'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-stream-cli-'));
const fake = path.join(tmp, 'fake.cjs');
const messages = path.join(tmp, 'messages');
fs.mkdirSync(messages); fs.writeFileSync(path.join(messages, '[0]user.md'), 'hello');
const finalPrompt = path.join(messages, 'final.md');
const streamConfig = path.join(tmp, 'stream.toml');
fs.writeFileSync(finalPrompt, 'produce the final answer');
fs.writeFileSync(streamConfig, `[promptpile-react]\ndirs=["${messages.replace(/\\/g, '\\\\')}"]\nfinal_prompt="final.md"\n`);
fs.writeFileSync(fake, [
  "const fs=require('fs'),path=require('path'); const a=process.argv.slice(2);",
  "process.stdout.write('child stdout noise\\n'); process.stderr.write('child stderr noise\\n');",
  "const oi=a.indexOf('-o'); if(oi>=0){ const o=a[oi+1]; fs.writeFileSync(o,'phase output'); if(a.includes('--tool-choice')){const p=path.parse(o); fs.writeFileSync(path.join(p.dir,p.name+'.calls.jsonl'),JSON.stringify({id:'c',type:'function',function:{name:'react_check_decision',arguments:'{\\\"decision\\\":false}'}})+'\\n');}}",
  "const fi=a.indexOf('--output-pile-fd'); if(fi>=0){const s=fs.createWriteStream('',{fd:Number(a[fi+1])}); s.write(JSON.stringify({type:'assistant_delta',content:'最终'})+'\\n'); s.end(JSON.stringify({type:'assistant_done'})+'\\n');}"
].join('\n'));
const bundledCli = require.resolve('promptpile/package.json');
const bundledMetadata = JSON.parse(fs.readFileSync(bundledCli));
const bundledBin = path.resolve(path.dirname(bundledCli), bundledMetadata.bin.promptpile);
const originalBundledBin = fs.readFileSync(bundledBin);
fs.copyFileSync(fake, bundledBin);
const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: tmp, encoding: 'utf8', env: { ...process.env, PROMPTPILE_BIN: '' } });
try {
  const bad = run(['-d', messages, '--output-format', 'yaml']);
  assert.notStrictEqual(bad.status, 0); assert.strictEqual(bad.stdout, '');

  const result = run(['--config', streamConfig, '--output-format', 'stream-json', '--quiet']);
  assert.strictEqual(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  const events = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepStrictEqual(events.map(event => event.sequence), events.map((_event, index) => index));
  assert.strictEqual(events[0].type, 'session.started');
  assert.strictEqual(events.at(-1).type, 'session.completed');
  assert.strictEqual(events.filter(event => event.type === 'session.completed').length, 1);
  assert.strictEqual(events.filter(event => event.type === 'session.failed').length, 0);
  const deltas = events.filter(event => event.type === 'final.delta').map(event => event.content).join('');
  assert.strictEqual(deltas, events.at(-1).final.content);
  assert.ok(!result.stdout.includes('child stdout noise'));

  fs.writeFileSync(path.join(messages, 'empty-final.md'), '');
  const config = path.join(tmp, 'skip.toml');
  fs.writeFileSync(config, `[promptpile-react]\ndirs=["${messages.replace(/\\/g, '\\\\')}"]\nfinal_prompt="empty-final.md"\n`);
  const skipped = run(['--config', config, '--output-format', 'stream-json']);
  assert.strictEqual(skipped.status, 0, skipped.stderr);
  const skipEvents = skipped.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.strictEqual(skipEvents.at(-1).final.status, 'skipped');
  assert.ok(!skipEvents.some(event => event.phase === 'final' || event.type === 'final.delta'));

  fs.writeFileSync(fake, "process.exitCode=7;\n");
  fs.copyFileSync(fake, bundledBin);
  const failed = run(['-d', messages, '--output-format', 'stream-json']);
  assert.notStrictEqual(failed.status, 0);
  const failureEvents = failed.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.strictEqual(failureEvents.at(-1).type, 'session.failed');
  assert.strictEqual(failureEvents.at(-1).phase, 'thought');
  assert.strictEqual(failureEvents.at(-1).error.code, 'promptpile_exit_nonzero');
  assert.ok(!failureEvents.some(event => event.type === 'session.completed' || event.phase === 'final'));
  console.log('promptpile-react stream-json CLI tests ok');
} finally {
  fs.writeFileSync(bundledBin, originalBundledBin);
  fs.rmSync(tmp, { recursive: true, force: true });
}
