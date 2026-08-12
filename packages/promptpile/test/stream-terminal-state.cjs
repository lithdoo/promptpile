'use strict';

const assert = require('assert');
const path = require('path');
const {
  ChatCompletionStreamProtocolError,
  createCompletionTerminalState,
  parseCompletionDataPayload,
  validateCompletionTerminalState
} = require(path.join(__dirname, '..', 'dist', 'ai-client.js'));

const withFinish = createCompletionTerminalState();
parseCompletionDataPayload('{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}', withFinish);
validateCompletionTerminalState(withFinish);
assert.strictEqual(withFinish.finishReason, 'stop');

const withDone = createCompletionTerminalState();
parseCompletionDataPayload('[DONE]', withDone);
validateCompletionTerminalState(withDone);

const empty = createCompletionTerminalState();
assert.strictEqual(parseCompletionDataPayload('', empty), undefined);
assert.throws(
  () => validateCompletionTerminalState(empty),
  error => error instanceof ChatCompletionStreamProtocolError && /without a terminal marker/.test(error.message)
);

const partial = createCompletionTerminalState();
parseCompletionDataPayload('{"choices":[{"delta":{"content":"partial"}}]}', partial);
assert.throws(() => validateCompletionTerminalState(partial), /without a terminal marker/);

const malformed = createCompletionTerminalState();
assert.throws(() => parseCompletionDataPayload('{broken', malformed), /malformed non-empty data payload/);

console.log('stream-terminal-state.cjs: ok');
