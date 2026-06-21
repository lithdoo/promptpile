'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.join(__dirname, '..');
const {
  scanDirectory,
  buildMessages,
  parseAssistantExtraFile,
  appendAssistantTurn,
  nextAssistantIdx
} = require(path.join(root, 'dist', 'file-handler.js'));
const { pickNonEmptyString } = require(path.join(root, 'dist', 'ai-client.js'));

assert.strictEqual(pickNonEmptyString('  hi  '), '  hi  ');
assert.strictEqual(pickNonEmptyString(''), undefined);
assert.strictEqual(pickNonEmptyString(null), undefined);

assert.strictEqual(
  parseAssistantExtraFile('{"reasoning_content":"think"}'),
  'think'
);
assert.throws(() => parseAssistantExtraFile(''), /empty/);
assert.throws(() => parseAssistantExtraFile('{"reasoning_content":""}'), /non-empty/);
assert.throws(() => parseAssistantExtraFile('{}'), /non-empty/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-extra-'));
try {
  fs.writeFileSync(path.join(tmp, '[1]user.md'), 'hello', 'utf8');
  fs.writeFileSync(path.join(tmp, '[2]assistant.md'), 'reply', 'utf8');
  fs.writeFileSync(
    path.join(tmp, '[2]assistant.calls.jsonl'),
    JSON.stringify({
      id: 'call_1',
      type: 'function',
      function: { name: 'tool', arguments: '{}' }
    }) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(tmp, '[2]assistant.extra.json'),
    JSON.stringify({ reasoning_content: 'chain of thought' }, null, 2) + '\n',
    'utf8'
  );

  const files = scanDirectory(tmp);
  const extraFile = files.find(f => f.fileKind === 'assistant_extra');
  assert.ok(extraFile, 'scans assistant.extra.json');
  assert.strictEqual(extraFile.idx, 2);

  const messages = buildMessages(files);
  const assistant = messages.find(m => m.role === 'assistant');
  assert.ok(assistant);
  assert.strictEqual(assistant.content, 'reply');
  assert.strictEqual(assistant.reasoning_content, 'chain of thought');
  assert.strictEqual(assistant.tool_calls.length, 1);
  assert.strictEqual(assistant.tool_calls[0].id, 'call_1');

  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-extra-only-'));
  try {
    fs.writeFileSync(
      path.join(tmp2, '[2]assistant.extra.json'),
      JSON.stringify({ reasoning_content: 'only think' }) + '\n',
      'utf8'
    );
    const msgsOnlyExtra = buildMessages(scanDirectory(tmp2));
    assert.strictEqual(msgsOnlyExtra.length, 1);
    assert.strictEqual(msgsOnlyExtra[0].role, 'assistant');
    assert.strictEqual(msgsOnlyExtra[0].content, null);
    assert.strictEqual(msgsOnlyExtra[0].reasoning_content, 'only think');
  } finally {
    fs.rmSync(tmp2, { recursive: true, force: true });
  }

  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-append-extra-'));
  try {
    const emptyFiles = scanDirectory(tmp3);
    const saved = appendAssistantTurn(tmp3, emptyFiles, 'text', undefined, 'reasoning blob');
    assert.ok(saved.extraPath);
    assert.ok(fs.existsSync(saved.extraPath));
    const doc = JSON.parse(fs.readFileSync(saved.extraPath, 'utf8'));
    assert.strictEqual(doc.reasoning_content, 'reasoning blob');
    assert.ok(fs.existsSync(path.join(tmp3, `[${saved.idx}]assistant.md`)));
  } finally {
    fs.rmSync(tmp3, { recursive: true, force: true });
  }

  const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-next-idx-'));
  try {
    fs.writeFileSync(path.join(tmp4, '[3]assistant.extra.json'), '{}', 'utf8');
    const idx = nextAssistantIdx(tmp4, scanDirectory(tmp4));
    assert.strictEqual(idx, 4);
  } finally {
    fs.rmSync(tmp4, { recursive: true, force: true });
  }

  const tmp5 = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-non-recursive-'));
  try {
    fs.writeFileSync(path.join(tmp5, '[0]system.md'), 'root system', 'utf8');
    fs.writeFileSync(path.join(tmp5, '[1]assistant.md'), 'root reply', 'utf8');
    fs.writeFileSync(
      path.join(tmp5, '[1]assistant.calls.jsonl'),
      JSON.stringify({ id: 'call_root', type: 'function', function: { name: 'root_tool', arguments: '{}' } }) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmp5, '[1]assistant.extra.json'),
      JSON.stringify({ reasoning_content: 'root reasoning' }) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmp5, '[1]assistant.result.jsonl'),
      JSON.stringify({ tool_call_id: 'call_root', name: 'root_tool', content: 'root result' }) + '\n',
      'utf8'
    );

    const nested = path.join(tmp5, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, '[9]user.md'), 'nested user', 'utf8');
    fs.writeFileSync(
      path.join(nested, '[9]assistant.calls.jsonl'),
      JSON.stringify({ id: 'call_nested', type: 'function', function: { name: 'nested_tool', arguments: '{}' } }) + '\n',
      'utf8'
    );

    const rootFiles = scanDirectory(tmp5);
    assert.deepStrictEqual(
      rootFiles.map(file => path.basename(file.path)),
      [
        '[0]system.md',
        '[1]assistant.md',
        '[1]assistant.calls.jsonl',
        '[1]assistant.extra.json',
        '[1]assistant.result.jsonl'
      ]
    );
    assert.ok(rootFiles.every(file => path.dirname(file.path) === tmp5));

    const rootMessages = buildMessages(rootFiles);
    assert.strictEqual(rootMessages.length, 3);
    assert.strictEqual(rootMessages[1].content, 'root reply');
    assert.strictEqual(rootMessages[1].reasoning_content, 'root reasoning');
    assert.strictEqual(rootMessages[1].tool_calls[0].id, 'call_root');
    assert.strictEqual(rootMessages[2].tool_call_id, 'call_root');
    assert.strictEqual(rootMessages[2].content, 'root result');
    assert.strictEqual(nextAssistantIdx(tmp5, rootFiles), 2);
  } finally {
    fs.rmSync(tmp5, { recursive: true, force: true });
  }

  console.log('assistant-extra-reasoning tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
