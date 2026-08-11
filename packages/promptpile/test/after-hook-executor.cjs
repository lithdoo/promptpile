'use strict';
const assert = require('assert');
const { EventEmitter } = require('events');
const {
  MAX_AFTER_HOOK_STDERR_TAIL_BYTES,
  runAfterHook
} = require('../dist/after-hook.js');

const fakeSpawn = (emit, inspectOptions) => (_command, _args, options) => {
  inspectOptions?.(options);
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => emit(child));
  return child;
};

(async () => {
  const base = { scriptPath: '/hook.sh', scanAbs: process.cwd(), hookEnv: {} };
  const success = await runAfterHook({
    ...base,
    spawnProcess: fakeSpawn(child => child.emit('close', 0, null), options => {
      assert.deepStrictEqual(options.stdio, ['ignore', 'ignore', 'pipe']);
    })
  });
  assert.deepStrictEqual(success, { status: 'succeeded', path: '/hook.sh', exitCode: 0 });

  const nonzero = await runAfterHook({
    ...base,
    spawnProcess: fakeSpawn(child => {
      const bytes = Buffer.concat([
        Buffer.from('discarded-prefix'),
        Buffer.alloc(MAX_AFTER_HOOK_STDERR_TAIL_BYTES, 0x78)
      ]);
      child.stderr.emit('data', bytes);
      child.emit('close', 7, null);
    })
  });
  assert.strictEqual(nonzero.status, 'exited_nonzero');
  assert.strictEqual(nonzero.exitCode, 7);
  assert.strictEqual(Buffer.byteLength(nonzero.stderrTail), MAX_AFTER_HOOK_STDERR_TAIL_BYTES);
  assert.strictEqual(nonzero.stderrTruncated, true);
  assert.ok(/^x+$/.test(nonzero.stderrTail));

  const signaled = await runAfterHook({
    ...base,
    spawnProcess: fakeSpawn(child => child.emit('close', null, 'SIGTERM'))
  });
  assert.strictEqual(signaled.status, 'signaled');
  assert.strictEqual(signaled.signal, 'SIGTERM');

  const spawnError = Object.assign(new Error('cannot spawn'), { code: 'ENOENT' });
  const failed = await runAfterHook({
    ...base,
    spawnProcess: fakeSpawn(child => {
      child.emit('error', spawnError);
      child.emit('close', 127, null);
    })
  });
  assert.deepStrictEqual(failed, {
    status: 'spawn_failed', path: '/hook.sh', errorCode: 'ENOENT', message: 'cannot spawn'
  });

  const synchronous = await runAfterHook({
    ...base,
    spawnProcess() { throw spawnError; }
  });
  assert.strictEqual(synchronous.status, 'spawn_failed');
  assert.strictEqual(synchronous.errorCode, 'ENOENT');

  console.log('after-hook executor tests ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
