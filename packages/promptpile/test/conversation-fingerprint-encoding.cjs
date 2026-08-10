'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  ConversationFingerprintError,
  buildConversationFingerprintResult,
  buildConversationFingerprintToken,
  digestConversationFingerprintV1,
  encodeConversationFingerprintV1,
  formatConversationFingerprintJson,
  formatConversationFingerprintText
} = require('../dist/conversation-fingerprint');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest();

const EMPTY_ENCODED_HEX =
  '70726f6d707470696c652d636f6e766572736174696f6e2d66696e6765727072696e742d763100' +
  '0000000000000000';
const EMPTY_TOKEN =
  'promptpile-conversation-v1:sha256:498248e5b997616e75071150e4d4e28f02ef0542c5292058a21efea8fb5865ee';
const POPULATED_ENCODED_HEX =
  '70726f6d707470696c652d636f6e766572736174696f6e2d66696e6765727072696e742d763100' +
  '0000000000000002' +
  '01' +
  '0000000d' + '5b30315de794a8e688b72e6d64' +
  '00' +
  '00000006' + 'e794a8e688b7' +
  '00' +
  '0000000000000003' +
  'a0956176ad28cadf4a54b314f9fcd6143d7007957454286ff24580445304b558' +
  '01' +
  '00000018' + '5b325d617373697374616e742e63616c6c732e6a736f6e6c' +
  '01' +
  '00000009' + '617373697374616e74' +
  '02' +
  '0000000000000000' +
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const POPULATED_TOKEN =
  'promptpile-conversation-v1:sha256:b7ed258c1664a2c34ca68ef7756b22e8d02426bb35a3ae1d89a1eeca123811f2';

const records = [
  {
    relativePath: '[01]\u7528\u6237.md',
    kind: 'message',
    role: '\u7528\u6237',
    extension: 'md',
    byteLength: 3n,
    contentSha256: sha256(Buffer.from([0x00, 0x0a, 0xff]))
  },
  {
    relativePath: '[2]assistant.calls.jsonl',
    kind: 'assistant_call',
    role: 'assistant',
    extension: 'jsonl',
    byteLength: 0n,
    contentSha256: sha256(Buffer.alloc(0))
  }
];

assert.strictEqual(encodeConversationFingerprintV1([]).toString('hex'), EMPTY_ENCODED_HEX);
assert.strictEqual(buildConversationFingerprintToken(digestConversationFingerprintV1([])), EMPTY_TOKEN);
assert.strictEqual(encodeConversationFingerprintV1(records).toString('hex'), POPULATED_ENCODED_HEX);
assert.strictEqual(
  buildConversationFingerprintToken(digestConversationFingerprintV1(records)),
  POPULATED_TOKEN
);

const result = buildConversationFingerprintResult(records, 2);
assert.deepStrictEqual(result, {
  schemaVersion: 1,
  fingerprintVersion: 1,
  algorithm: 'sha256',
  artifactCount: 2,
  maxIndex: 2,
  fingerprint: POPULATED_TOKEN
});
assert.strictEqual(formatConversationFingerprintText(result), `${POPULATED_TOKEN}\n`);
assert.strictEqual(formatConversationFingerprintJson(result), `${JSON.stringify(result, null, 2)}\n`);
assert.deepStrictEqual(JSON.parse(formatConversationFingerprintJson(result)), result);

const expectEncodingError = fn => assert.throws(
  fn,
  error => error instanceof ConversationFingerprintError &&
    error.code === 'internal_encoding_error'
);
expectEncodingError(() => buildConversationFingerprintToken(Buffer.alloc(31)));
expectEncodingError(() => encodeConversationFingerprintV1([
  { ...records[0], contentSha256: Buffer.alloc(31) }
]));
expectEncodingError(() => encodeConversationFingerprintV1([
  { ...records[0], byteLength: -1n }
]));
expectEncodingError(() => encodeConversationFingerprintV1([
  { ...records[0], kind: 'future_kind' }
]));
expectEncodingError(() => encodeConversationFingerprintV1([
  { ...records[0], extension: 'txt' }
]));

console.log('conversation fingerprint canonical encoding tests ok');
