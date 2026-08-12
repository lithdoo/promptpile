'use strict';
const assert = require('assert');
const path = require('path');
const { FinalOutputPileDecoder } = require(path.join(__dirname, '..', 'dist', 'final-output-pile-decoder.js'));

const decode = async chunks => {
  const deltas = [];
  const decoder = new FinalOutputPileDecoder(async content => { deltas.push(content); });
  for (const chunk of chunks) await decoder.push(Buffer.from(chunk));
  await decoder.finish();
  return deltas;
};
(async () => {
  assert.deepStrictEqual(await decode(['{"type":"assistant_delta","content":"你', '好"}\n{"type":"assistant_done"}']), ['你好']);
  const utf8 = Buffer.from('{"type":"assistant_delta","content":"中文"}\n{"type":"assistant_done"}\n');
  const split = utf8.indexOf(Buffer.from('中')) + 1;
  assert.deepStrictEqual(await decode([utf8.subarray(0, split), utf8.subarray(split)]), ['中文']);
  assert.deepStrictEqual(await decode(['{"type":"assistant_delta","content":"a"}\n{"type":"assistant_delta","content":"b"}\n{"type":"assistant_done"}\n']), ['a', 'b']);
  for (const input of [
    '{broken\n',
    '{"type":"assistant_delta","content":1}\n',
    '{"type":"unknown"}\n',
    '{"type":"assistant_done"}\n{"type":"assistant_delta","content":"late"}\n',
    '{"type":"assistant_done"}\n{"type":"assistant_done"}\n',
    '{"type":"error","message":"bad"}\n',
    '{"type":"assistant_delta","content":"missing done"}\n'
  ]) await assert.rejects(decode([input]), /final stream|assistant/);
  await assert.rejects(decode([`{"type":"assistant_delta","content":"${'x'.repeat(1024 * 1024)}"}\n`]), /1 MiB/);
  console.log('promptpile-react Final decoder tests ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
