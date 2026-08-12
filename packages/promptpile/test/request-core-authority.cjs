'use strict';

const assert = require('assert');
const path = require('path');

const packageRoot = path.join(__dirname, '..');
const { createPayload } = require(path.join(packageRoot, 'dist', 'ai-client.js'));

const messages = [{ role: 'user', content: 'hello' }];
const tools = [{ type: 'function', function: { name: 'lookup', parameters: {} } }];
const payload = createPayload(
  'owned-model',
  messages,
  true,
  tools,
  { type: 'function', function: { name: 'lookup' } },
  0.4,
  { top_p: 0.9 }
);

assert.strictEqual(payload.model, 'owned-model');
assert.strictEqual(payload.messages, messages);
assert.strictEqual(payload.stream, true);
assert.strictEqual(payload.temperature, 0.4);
assert.strictEqual(payload.tools, tools);
assert.deepStrictEqual(payload.tool_choice, { type: 'function', function: { name: 'lookup' } });
assert.strictEqual(payload.top_p, 0.9);

const disabled = createPayload('owned-model', messages, true, undefined, undefined, 0.4, {
  top_p: 0.9
});
assert.strictEqual(Object.hasOwn(disabled, 'tools'), false);
assert.strictEqual(Object.hasOwn(disabled, 'tool_choice'), false);

for (const key of ['model', 'messages', 'stream', 'temperature', 'tools', 'tool_choice']) {
  assert.throws(
    () => createPayload('owned-model', messages, true, undefined, undefined, 0.4, { [key]: null }),
    new RegExp(`reserved request field: ${key}$`)
  );
}

console.log('request-core-authority.cjs: ok');
