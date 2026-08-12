'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fingerprint = require('../dist/fingerprint');

const emptyEncoded =
  '70726f6d707470696c652d636f6e766572736174696f6e2d66696e6765727072696e742d763100' +
  '0000000000000000';
const emptyToken =
  'promptpile-conversation-v1:sha256:498248e5b997616e75071150e4d4e28f02ef0542c5292058a21efea8fb5865ee';
const populatedEncoded =
  '70726f6d707470696c652d636f6e766572736174696f6e2d66696e6765727072696e742d763100' +
  '0000000000000002' + '01' + '0000000d' + '5b30315de794a8e688b72e6d64' + '00' +
  '00000006' + 'e794a8e688b7' + '00' + '0000000000000003' +
  'a0956176ad28cadf4a54b314f9fcd6143d7007957454286ff24580445304b558' + '01' +
  '00000018' + '5b325d617373697374616e742e63616c6c732e6a736f6e6c' + '01' +
  '00000009' + '617373697374616e74' + '02' + '0000000000000000' +
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const sha256 = value => crypto.createHash('sha256').update(value).digest();
const records = [
  { relativePath: '[01]用户.md', kind: 'message', role: '用户', extension: 'md', byteLength: 3n,
    contentSha256: sha256(Buffer.from([0x00, 0x0a, 0xff])) },
  { relativePath: '[2]assistant.calls.jsonl', kind: 'assistant_call', role: 'assistant',
    extension: 'jsonl', byteLength: 0n, contentSha256: sha256(Buffer.alloc(0)) }
];

assert.strictEqual(Buffer.from(fingerprint.encodeConversationFingerprintV1([])).toString('hex'), emptyEncoded);
assert.strictEqual(
  fingerprint.buildConversationFingerprintTokenV1(fingerprint.digestConversationFingerprintV1([])),
  emptyToken
);
assert.strictEqual(Buffer.from(fingerprint.encodeConversationFingerprintV1(records)).toString('hex'), populatedEncoded);
assert.strictEqual(fingerprint.parseConversationFingerprintTokenV1(emptyToken), emptyToken);
assert.throws(() => fingerprint.parseConversationFingerprintTokenV1(emptyToken.toUpperCase()));
assert.throws(() => fingerprint.buildConversationFingerprintTokenV1(Buffer.alloc(31)));
assert.throws(() => fingerprint.encodeConversationFingerprintV1([{ ...records[0], byteLength: -1n }]));
assert.throws(() => fingerprint.encodeConversationFingerprintV1([{ ...records[0], contentSha256: Buffer.alloc(31) }]));
console.log('conversation fingerprint protocol primitives ok');
