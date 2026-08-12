'use strict';
const assert = require('assert');
const { PassThrough, Writable } = require('stream');
const path = require('path');
const { ReactEventWriterV1 } = require(path.join(__dirname, '..', 'dist', 'react-event-writer.js'));

(async () => {
  const output = new PassThrough();
  let text = '';
  output.setEncoding('utf8'); output.on('data', chunk => { text += chunk; });
  const writer = new ReactEventWriterV1(output, 'fixed');
  await Promise.all([
    writer.emit({ type: 'session.started', max_steps: 1 }),
    writer.emit({ type: 'final.delta', content: 'x' }),
    writer.emit({ type: 'session.completed', stop_reason: 'final', steps_completed: 0, final: { status: 'completed', content: 'x' } })
  ]);
  const events = text.trim().split('\n').map(JSON.parse);
  assert.deepStrictEqual(events.map(event => event.sequence), [0, 1, 2]);
  assert.ok(events.every(event => event.session_id === 'fixed' && event.schema_version === 1));
  assert.strictEqual(writer.hasTerminated(), true);
  await assert.rejects(writer.emit({ type: 'final.delta', content: 'late' }), /terminal/);

  const broken = new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error('pipe closed'), { code: 'EPIPE' })); } });
  const brokenWriter = new ReactEventWriterV1(broken, 'broken');
  await assert.rejects(brokenWriter.emit({ type: 'session.started', max_steps: 1 }), /protocol output/);
  assert.strictEqual(brokenWriter.isWritable(), false);
  console.log('promptpile-react event writer tests ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
