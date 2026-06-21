'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.join(__dirname, '..');
const { atomicWriteFileSync } = require(path.join(root, 'dist', 'atomic-file.js'));
const {
  appendAssistantTurn,
  buildMessagesWithDiagnostics,
  nextAssistantIdx,
  scanDirectory
} = require(path.join(root, 'dist', 'file-handler.js'));
const { applyMissingToolResultsPolicy } = require(path.join(root, 'dist', 'tool-result-policy.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-atomic-'));
try {
  const target = path.join(tmp, 'value.txt');
  atomicWriteFileSync(target, 'first');
  atomicWriteFileSync(target, 'second');
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'second');
  assert.ok(!fs.readdirSync(tmp).some(name => name.includes('.tmp-')));

  const invalidTarget = path.join(tmp, 'target-dir');
  fs.mkdirSync(invalidTarget);
  assert.throws(() => atomicWriteFileSync(invalidTarget, 'nope'));
  assert.ok(fs.statSync(invalidTarget).isDirectory());
  assert.ok(!fs.readdirSync(tmp).some(name => name.includes('.tmp-')));

  const messagesDir = path.join(tmp, 'messages');
  fs.mkdirSync(messagesDir);
  const calls = [
    { id: 'call_1', type: 'function', function: { name: 'one', arguments: '{}' } },
    { id: 'call_2', type: 'function', function: { name: 'two', arguments: '{}' } }
  ];
  fs.writeFileSync(
    path.join(messagesDir, '[2]assistant.calls.jsonl'),
    calls.map(JSON.stringify).join('\n') + '\n'
  );

  let built = buildMessagesWithDiagnostics(scanDirectory(messagesDir));
  assert.strictEqual(built.diagnostics.length, 2);
  assert.ok(built.diagnostics.every(d => d.reason === 'result_file_missing'));
  assert.strictEqual(built.messages.filter(m => m.role === 'tool').length, 2);

  fs.writeFileSync(
    path.join(messagesDir, '[2]assistant.result.jsonl'),
    JSON.stringify({ tool_call_id: 'call_1', name: 'one', content: 'ok' }) + '\n'
  );
  built = buildMessagesWithDiagnostics(scanDirectory(messagesDir));
  assert.strictEqual(built.diagnostics.length, 1);
  assert.strictEqual(built.diagnostics[0].toolCallId, 'call_2');
  assert.strictEqual(built.diagnostics[0].reason, 'tool_call_id_missing');

  const warnings = [];
  applyMissingToolResultsPolicy(built.diagnostics, 'warn', message => warnings.push(message));
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /Warning: Incomplete tool result/);
  applyMissingToolResultsPolicy(built.diagnostics, 'ignore', () => {
    throw new Error('ignore must not warn');
  });
  assert.throws(
    () => applyMissingToolResultsPolicy(built.diagnostics, 'error'),
    /Incomplete tool result/
  );

  const turnDir = path.join(tmp, 'turns');
  fs.mkdirSync(turnDir);
  fs.writeFileSync(path.join(turnDir, '[0]assistant.md'), 'existing');
  const turnFiles = scanDirectory(turnDir);
  assert.strictEqual(nextAssistantIdx(turnDir, turnFiles), 1);

  const saved = appendAssistantTurn(turnDir, turnFiles, 'reply', calls.slice(0, 1), 'reasoning');
  assert.strictEqual(saved.idx, 1);
  assert.strictEqual(path.basename(saved.mdPath), '[1]assistant.md');
  assert.strictEqual(path.basename(saved.callsPath), '[1]assistant.calls.jsonl');
  assert.strictEqual(path.basename(saved.extraPath), '[1]assistant.extra.json');
  assert.strictEqual(fs.readFileSync(saved.mdPath, 'utf8'), 'reply');
  assert.ok(!fs.readdirSync(turnDir).some(name => name.includes('.tmp-')));

  console.log('atomic-and-diagnostics tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
