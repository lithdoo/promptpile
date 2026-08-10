import fs from 'fs';
import { createHash } from 'crypto';
import { scanDirectory } from './file-handler';
import type { FileInfo, FileKind } from './types';

const DOMAIN_HEADER = Buffer.from('promptpile-conversation-fingerprint-v1\0', 'ascii');
const TOKEN_PREFIX = 'promptpile-conversation-v1:sha256:';
const U32_MAX = 0xffff_ffff;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

const KIND_CODES: Record<FileKind, number> = {
  message: 0x00,
  assistant_call: 0x01,
  assistant_extra: 0x02,
  assistant_result: 0x03
};

const EXTENSION_CODES = {
  md: 0x00,
  json: 0x01,
  jsonl: 0x02
} as const;

export type ConversationFingerprintErrorCode =
  | 'invalid_directory'
  | 'artifact_unreadable'
  | 'unstable_observation'
  | 'internal_encoding_error';

export class ConversationFingerprintError extends Error {
  readonly code: ConversationFingerprintErrorCode;
  readonly cause?: unknown;

  constructor(code: ConversationFingerprintErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ConversationFingerprintError';
    this.code = code;
    this.cause = cause;
  }
}

export interface FingerprintArtifactObservation {
  relativePath: string;
  kind: FileKind;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  byteLength: bigint;
  contentSha256: Uint8Array;
}

export interface ConversationFingerprintResult {
  schemaVersion: 1;
  fingerprintVersion: 1;
  algorithm: 'sha256';
  artifactCount: number;
  maxIndex: number | null;
  fingerprint: string;
}

export type ConversationFingerprintFormat = 'text' | 'json';

export interface ConversationObservationHooks {
  afterScanStart?: (observationOrdinal: 1 | 2) => void | Promise<void>;
  afterArtifactRead?: (
    observationOrdinal: 1 | 2,
    relativePath: string
  ) => void | Promise<void>;
  afterObservation?: (observationOrdinal: 1 | 2) => void | Promise<void>;
}

export interface ConversationObservationDependencies {
  scan?: (directory: string) => FileInfo[];
  openArtifact?: (filePath: string) => AsyncIterable<Buffer | string>;
  hooks?: ConversationObservationHooks;
}

interface CollectedConversationObservation {
  records: FingerprintArtifactObservation[];
  maxIndex: number | null;
}

const encodingError = (message: string): never => {
  throw new ConversationFingerprintError('internal_encoding_error', message);
};

const encodeU32 = (value: number, label: string): Buffer => {
  if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
    return encodingError(`${label} is outside unsigned u32 range`);
  }
  const encoded = Buffer.allocUnsafe(4);
  encoded.writeUInt32BE(value, 0);
  return encoded;
};

const encodeU64 = (value: bigint, label: string): Buffer => {
  if (value < 0n || value > U64_MAX) {
    return encodingError(`${label} is outside unsigned u64 range`);
  }
  const encoded = Buffer.allocUnsafe(8);
  encoded.writeBigUInt64BE(value, 0);
  return encoded;
};

const encodeString = (value: string, label: string): Buffer[] => {
  const bytes = Buffer.from(value, 'utf8');
  return [encodeU32(bytes.length, `${label} byte length`), bytes];
};

/** Encode already ordered observations using the frozen Conversation Fingerprint v1 format. */
export const encodeConversationFingerprintV1 = (
  records: readonly FingerprintArtifactObservation[]
): Buffer => {
  const chunks: Buffer[] = [DOMAIN_HEADER, encodeU64(BigInt(records.length), 'artifact count')];

  for (const record of records) {
    const kindCode = KIND_CODES[record.kind];
    const extensionCode = EXTENSION_CODES[record.extension];
    if (kindCode === undefined) {
      encodingError(`unknown artifact kind: ${String(record.kind)}`);
    }
    if (extensionCode === undefined) {
      encodingError(`unknown artifact extension: ${String(record.extension)}`);
    }
    if (record.contentSha256.byteLength !== 32) {
      encodingError(`content SHA-256 for ${record.relativePath} must contain exactly 32 bytes`);
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
};

export const digestConversationFingerprintV1 = (
  records: readonly FingerprintArtifactObservation[]
): Buffer => createHash('sha256').update(encodeConversationFingerprintV1(records)).digest();

export const buildConversationFingerprintToken = (digest: Uint8Array): string => {
  if (digest.byteLength !== 32) {
    encodingError('conversation SHA-256 digest must contain exactly 32 bytes');
  }
  return `${TOKEN_PREFIX}${Buffer.from(digest).toString('hex')}`;
};

export const buildConversationFingerprintResult = (
  records: readonly FingerprintArtifactObservation[],
  maxIndex: number | null
): ConversationFingerprintResult => ({
  schemaVersion: 1,
  fingerprintVersion: 1,
  algorithm: 'sha256',
  artifactCount: records.length,
  maxIndex,
  fingerprint: buildConversationFingerprintToken(digestConversationFingerprintV1(records))
});

export const formatConversationFingerprintText = (
  result: ConversationFingerprintResult
): string => `${result.fingerprint}\n`;

export const formatConversationFingerprintJson = (
  result: ConversationFingerprintResult
): string => `${JSON.stringify(result, null, 2)}\n`;

const sameScan = (a: readonly FileInfo[], b: readonly FileInfo[]): boolean =>
  a.length === b.length && a.every((left, index) => {
    const right = b[index];
    return right !== undefined &&
      left.relativePath === right.relativePath &&
      left.idx === right.idx &&
      left.fileKind === right.fileKind &&
      left.role === right.role &&
      left.extension === right.extension;
  });

const sameObservation = (
  a: CollectedConversationObservation,
  b: CollectedConversationObservation
): boolean => a.maxIndex === b.maxIndex &&
  a.records.length === b.records.length &&
  a.records.every((left, index) => {
    const right = b.records[index];
    return right !== undefined &&
      left.relativePath === right.relativePath &&
      left.kind === right.kind &&
      left.role === right.role &&
      left.extension === right.extension &&
      left.byteLength === right.byteLength &&
      Buffer.from(left.contentSha256).equals(Buffer.from(right.contentSha256));
  });

const hashArtifact = async (
  file: FileInfo,
  openArtifact: (filePath: string) => AsyncIterable<Buffer | string>
): Promise<FingerprintArtifactObservation> => {
  const hash = createHash('sha256');
  let byteLength = 0n;
  try {
    for await (const rawChunk of openArtifact(file.path)) {
      const chunk = typeof rawChunk === 'string' ? Buffer.from(rawChunk) : rawChunk;
      byteLength += BigInt(chunk.byteLength);
      hash.update(chunk);
    }
  } catch (error) {
    throw new ConversationFingerprintError(
      'artifact_unreadable',
      `unable to read Conversation artifact: ${file.relativePath}`,
      error
    );
  }
  return {
    relativePath: file.relativePath,
    kind: file.fileKind,
    role: file.role,
    extension: file.extension,
    byteLength,
    contentSha256: hash.digest()
  };
};

const validateDirectory = (directory: string): void => {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(directory);
  } catch (error) {
    throw new ConversationFingerprintError(
      'invalid_directory',
      `conversation directory does not exist: ${directory}`,
      error
    );
  }
  if (!stat.isDirectory()) {
    throw new ConversationFingerprintError(
      'invalid_directory',
      `conversation directory is not a directory: ${directory}`
    );
  }
};

const collectConversationObservation = async (
  directory: string,
  ordinal: 1 | 2,
  dependencies: ConversationObservationDependencies
): Promise<CollectedConversationObservation> => {
  const scan = dependencies.scan ?? ((target: string) => scanDirectory(target));
  const openArtifact = dependencies.openArtifact ?? ((filePath: string) => fs.createReadStream(filePath));
  let scanStart: FileInfo[];
  try {
    scanStart = scan(directory);
  } catch (error) {
    throw new ConversationFingerprintError(
      'unstable_observation',
      'unable to scan Conversation directory during observation',
      error
    );
  }

  await dependencies.hooks?.afterScanStart?.(ordinal);
  const records: FingerprintArtifactObservation[] = [];
  for (const file of scanStart) {
    records.push(await hashArtifact(file, openArtifact));
    await dependencies.hooks?.afterArtifactRead?.(ordinal, file.relativePath);
  }

  let scanEnd: FileInfo[];
  try {
    scanEnd = scan(directory);
  } catch (error) {
    throw new ConversationFingerprintError(
      'unstable_observation',
      'unable to rescan Conversation directory after reading artifacts',
      error
    );
  }
  if (!sameScan(scanStart, scanEnd)) {
    throw new ConversationFingerprintError(
      'unstable_observation',
      'Conversation artifacts changed during observation'
    );
  }

  return {
    records,
    maxIndex: scanStart.reduce<number | null>(
      (maximum, file) => maximum === null || file.idx > maximum ? file.idx : maximum,
      null
    )
  };
};

/** Compute a strong fingerprint only after two consecutive observations agree exactly. */
export const fingerprintConversationDirectory = async (
  directory: string,
  dependencies: ConversationObservationDependencies = {}
): Promise<ConversationFingerprintResult> => {
  validateDirectory(directory);
  const first = await collectConversationObservation(directory, 1, dependencies);
  await dependencies.hooks?.afterObservation?.(1);
  const second = await collectConversationObservation(directory, 2, dependencies);
  await dependencies.hooks?.afterObservation?.(2);
  if (!sameObservation(first, second)) {
    throw new ConversationFingerprintError(
      'unstable_observation',
      'two consecutive Conversation observations did not match'
    );
  }
  return buildConversationFingerprintResult(second.records, second.maxIndex);
};
