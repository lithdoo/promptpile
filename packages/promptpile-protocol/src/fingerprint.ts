import { createHash } from 'node:crypto';
import type { ConversationArtifactFileKindV1 } from './conversation';

const DOMAIN_HEADER = Buffer.from('promptpile-conversation-fingerprint-v1\0', 'ascii');
const TOKEN_PREFIX = 'promptpile-conversation-v1:sha256:';
const TOKEN_PATTERN = /^promptpile-conversation-v1:sha256:[0-9a-f]{64}$/;
const U32_MAX = 0xffff_ffff;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

const KIND_CODES: Record<ConversationArtifactFileKindV1, number> = {
  message: 0x00,
  assistant_call: 0x01,
  assistant_extra: 0x02,
  assistant_result: 0x03
};

const EXTENSION_CODES = { md: 0x00, json: 0x01, jsonl: 0x02 } as const;

export interface FingerprintArtifactObservationV1 {
  relativePath: string;
  kind: ConversationArtifactFileKindV1;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  byteLength: bigint;
  contentSha256: Uint8Array;
}

const fail = (message: string): never => {
  throw new RangeError(message);
};

const encodeU32 = (value: number, label: string): Buffer => {
  if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
    fail(`${label} is outside unsigned u32 range`);
  }
  const encoded = Buffer.allocUnsafe(4);
  encoded.writeUInt32BE(value, 0);
  return encoded;
};

const encodeU64 = (value: bigint, label: string): Buffer => {
  if (value < 0n || value > U64_MAX) fail(`${label} is outside unsigned u64 range`);
  const encoded = Buffer.allocUnsafe(8);
  encoded.writeBigUInt64BE(value, 0);
  return encoded;
};

const encodeString = (value: string, label: string): Buffer[] => {
  const bytes = Buffer.from(value, 'utf8');
  return [encodeU32(bytes.length, `${label} byte length`), bytes];
};

/** Encode already canonically ordered observations using Conversation Fingerprint v1. */
export function encodeConversationFingerprintV1(
  records: readonly FingerprintArtifactObservationV1[]
): Uint8Array {
  const chunks: Buffer[] = [DOMAIN_HEADER, encodeU64(BigInt(records.length), 'artifact count')];
  for (const record of records) {
    const kindCode = KIND_CODES[record.kind];
    const extensionCode = EXTENSION_CODES[record.extension];
    if (kindCode === undefined) fail(`unknown artifact kind: ${String(record.kind)}`);
    if (extensionCode === undefined) fail(`unknown artifact extension: ${String(record.extension)}`);
    if (record.contentSha256.byteLength !== 32) {
      fail(`content SHA-256 for ${record.relativePath} must contain exactly 32 bytes`);
    }
    chunks.push(Buffer.from([0x01]));
    chunks.push(...encodeString(record.relativePath, 'relative path'));
    chunks.push(Buffer.from([kindCode]));
    chunks.push(...encodeString(record.role, 'role'));
    chunks.push(Buffer.from([extensionCode]));
    chunks.push(encodeU64(record.byteLength, 'artifact byte length'));
    chunks.push(Buffer.from(record.contentSha256));
  }
  return Buffer.concat(chunks);
}

export function digestConversationFingerprintV1(
  records: readonly FingerprintArtifactObservationV1[]
): Uint8Array {
  return createHash('sha256').update(encodeConversationFingerprintV1(records)).digest();
}

export function buildConversationFingerprintTokenV1(digest: Uint8Array): string {
  if (digest.byteLength !== 32) fail('conversation SHA-256 digest must contain exactly 32 bytes');
  return `${TOKEN_PREFIX}${Buffer.from(digest).toString('hex')}`;
}

/** Validate and return the one canonical Conversation Fingerprint v1 token form. */
export function parseConversationFingerprintTokenV1(value: string): string {
  if (!TOKEN_PATTERN.test(value)) {
    throw new TypeError(
      'expected fingerprint must be promptpile-conversation-v1:sha256: followed by 64 lowercase hex characters'
    );
  }
  return value;
}
