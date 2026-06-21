'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.join(__dirname, '..');
const {
  isLlmDumpEnabled,
  makeDumpId,
  redactHeaders,
  writeLlmReqDump,
  writeLlmResDump
} = require(path.join(root, 'dist', 'llm-dump.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-llm-dump-'));
const prevDump = process.env.PROMPTPILE_DUMP_LLM;
try {
  delete process.env.PROMPTPILE_DUMP_LLM;
  assert.strictEqual(isLlmDumpEnabled(), false);

  process.env.PROMPTPILE_DUMP_LLM = '1';
  assert.strictEqual(isLlmDumpEnabled(), true);

  const { id, iso } = makeDumpId();
  assert.match(id, /^\d+-[0-9a-f]{8}$/);
  assert.ok(iso.includes('T'));

  const headers = redactHeaders({
    Authorization: 'Bearer sk-secret',
    'Content-Type': 'application/json'
  });
  assert.strictEqual(headers.Authorization, 'Bearer ***');

  writeLlmReqDump(
    tmp,
    id,
    { iso, url: 'https://example.com/v1/chat/completions', tag: 'observe' },
    { Authorization: 'Bearer sk-secret', 'Content-Type': 'application/json' },
    { model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] }
  );

  const reqPath = path.join(tmp, `${id}.req.json`);
  assert.ok(fs.existsSync(reqPath));
  const reqDoc = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
  assert.strictEqual(reqDoc.dumpVersion, 1);
  assert.strictEqual(reqDoc.tag, 'observe');
  assert.strictEqual(reqDoc.headers.Authorization, 'Bearer ***');
  assert.strictEqual(reqDoc.body.model, 'm');

  writeLlmResDump(
    tmp,
    id,
    { iso, tag: 'observe' },
    {
      ok: true,
      status: 200,
      stream: true,
      content: 'hello',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }]
    }
  );

  const resPath = path.join(tmp, `${id}.res.json`);
  assert.ok(fs.existsSync(resPath));
  const resDoc = JSON.parse(fs.readFileSync(resPath, 'utf8'));
  assert.strictEqual(resDoc.ok, true);
  assert.strictEqual(resDoc.content, 'hello');
  assert.strictEqual(resDoc.tool_calls.length, 1);

  writeLlmResDump(
    tmp,
    `${id}-r`,
    { iso, tag: 'thought' },
    {
      ok: true,
      status: 200,
      stream: true,
      content: 'hi',
      reasoning_content: 'thinking trace'
    }
  );
  const resReasoning = JSON.parse(fs.readFileSync(path.join(tmp, `${id}-r.res.json`), 'utf8'));
  assert.strictEqual(resReasoning.reasoning_content, 'thinking trace');

  console.log('llm-dump.cjs: ok');
} finally {
  if (prevDump === undefined) {
    delete process.env.PROMPTPILE_DUMP_LLM;
  } else {
    process.env.PROMPTPILE_DUMP_LLM = prevDump;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
