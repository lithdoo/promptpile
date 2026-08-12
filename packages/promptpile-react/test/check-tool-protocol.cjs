'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { parseObserveDecisionFromCallsFileStrict } = require(path.join(root, 'dist', 'parse-observe-calls.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-check-protocol-'));
const calls = path.join(tmp, 'calls.jsonl');
const toolName = 'react_check_decision';
const write = value => fs.writeFileSync(calls, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
const call = decision => ({ id: 'call-1', type: 'function', function: { name: 'react_check_decision', arguments: JSON.stringify({ decision }) } });

try {
  write(call(true));
  assert.strictEqual(parseObserveDecisionFromCallsFileStrict(calls, toolName), true);
  write(call(false));
  assert.strictEqual(parseObserveDecisionFromCallsFileStrict(calls, toolName), false);
  write('{broken');
  assert.throws(() => parseObserveDecisionFromCallsFileStrict(calls, toolName), /非法 JSON/i);
  write({ function: { name: 'react_check_decision', arguments: '{"decision":true}' } });
  assert.throws(() => parseObserveDecisionFromCallsFileStrict(calls, toolName), /ToolCallV1/);
  write({ id: 'call-1', type: 'function', function: { name: 'react_check_decision', arguments: '{"decision":"yes"}' } });
  assert.throws(() => parseObserveDecisionFromCallsFileStrict(calls, toolName), /decision.*boolean/i);
  fs.rmSync(calls);
  assert.throws(() => parseObserveDecisionFromCallsFileStrict(calls, toolName), /不存在/);
  console.log('promptpile-react check ToolCall protocol tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
