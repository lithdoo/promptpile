'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const protocol = require('../dist/conversation.js');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../fixtures/conversation-protocol-v1/cases.json'), 'utf8'));

for (const item of cases.indices) {
  assert.strictEqual(protocol.parseConversationIndexV1(item.raw), item.invalid ? undefined : item.value);
}
for (const item of cases.names) {
  assert.deepStrictEqual(protocol.classifyConversationArtifactNameV1(item.name), item.invalid ? undefined : item.value);
}
assert.strictEqual(protocol.MAX_CONVERSATION_INDEX_V1, Number.MAX_SAFE_INTEGER);
assert.strictEqual(protocol.formatAssistantArtifactNameV1(1, 'body'), '[1]assistant.md');
assert.strictEqual(protocol.formatAssistantArtifactNameV1(1, 'calls'), '[1]assistant.calls.jsonl');
assert.strictEqual(protocol.formatAssistantArtifactNameV1(1, 'extra'), '[1]assistant.extra.json');
assert.strictEqual(protocol.formatAssistantArtifactNameV1(1, 'result'), '[1]assistant.result.jsonl');
assert.throws(() => protocol.formatAssistantArtifactNameV1(-1, 'body'), RangeError);

const names = ['[1]assistant.result.jsonl', '[1]assistant.extra.json', '[1]assistant.calls.jsonl', '[1]assistant.md', '[1]用户.md', '[1]z.md'];
const entries = names.map(relativePath => ({ ...protocol.classifyConversationArtifactNameV1(relativePath), relativePath }));
entries.sort(protocol.compareConversationArtifactsV1);
assert.deepStrictEqual(entries.map(entry => entry.relativePath), ['[1]z.md', '[1]用户.md', '[1]assistant.md', '[1]assistant.calls.jsonl', '[1]assistant.extra.json', '[1]assistant.result.jsonl']);
