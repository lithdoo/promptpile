'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  invokePromptpileFinalStream
} = require(path.join(__dirname, '..', 'dist', 'promptpile-invoker.js'));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-final-invoker-'));
  const childFile = path.join(root, 'child.cjs');
  fs.writeFileSync(childFile, [
    "const fs=require('fs'); const mode=process.argv[2];",
    "process.stdout.write('stdout noise'); process.stderr.write('stderr diagnostic');",
    "const stream=fs.createWriteStream('',{fd:3,encoding:'utf8'});",
    "const line=value=>stream.write(typeof value==='string'?value:JSON.stringify(value)+'\\n');",
    "if(mode==='success'){line({type:'assistant_delta',content:'a'});line({type:'assistant_delta',content:'b'});line({type:'assistant_done'});}",
    "if(mode==='done-nonzero'){line({type:'assistant_done'});process.exitCode=7;}",
    "if(mode==='missing-done'){line({type:'assistant_delta',content:'partial'});}",
    "if(mode==='malformed'){line('{broken\\n');}",
    "if(mode==='unknown'){line({type:'unknown'});}",
    "if(mode==='duplicate-done'){line({type:'assistant_done'});line({type:'assistant_done'});}",
    "if(mode==='after-done'){line({type:'assistant_done'});line({type:'assistant_delta',content:'late'});}",
    "if(mode==='error-event'){line({type:'error',message:'private detail'});}",
    'stream.end();'
  ].join('\n'));

  const invoke = async mode => {
    const deltas = [];
    const result = await invokePromptpileFinalStream(
      { command: process.execPath, argvPrefix: [childFile, mode], displayName: 'fixture' },
      ['--output-pile-fd', '3', '--output-pile-format', 'json'],
      { cwd: root, quiet: true, onDelta: async delta => { deltas.push(delta); } }
    );
    return { result, deltas };
  };

  try {
    const success = await invoke('success');
    assert.strictEqual(success.result.status, 0);
    assert.strictEqual(success.result.streamError, undefined);
    assert.strictEqual(success.result.content, 'ab');
    assert.deepStrictEqual(success.deltas, ['a', 'b']);
    assert.strictEqual(success.result.stdout, '', 'child stdout is never forwarded or returned');
    assert.match(success.result.stderr, /stderr diagnostic/);

    const nonzero = await invoke('done-nonzero');
    assert.strictEqual(nonzero.result.status, 7);
    assert.strictEqual(nonzero.result.streamError, undefined, 'done is only the transport witness');

    for (const mode of ['missing-done', 'malformed', 'unknown', 'duplicate-done', 'after-done', 'error-event']) {
      const failure = await invoke(mode);
      assert.ok(failure.result.streamError, `${mode} must fail closed`);
    }

    const spawnFailure = await invokePromptpileFinalStream(
      { command: path.join(root, 'does-not-exist'), argvPrefix: [], displayName: 'missing' },
      [],
      { cwd: root, quiet: true, onDelta: async () => undefined }
    );
    assert.ok(spawnFailure.error);
    assert.notStrictEqual(spawnFailure.status, 0);
    console.log('promptpile-react Final stream invoker tests ok');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
