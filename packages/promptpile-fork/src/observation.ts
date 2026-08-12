import { constants } from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  buildConversationFingerprintTokenV1,
  digestConversationFingerprintV1
} from 'promptpile-protocol/fingerprint';
import { ForkError } from './errors';
import { sameArtifactEntries, scanSelectedArtifacts } from './scanner';
import type { ForkArtifactEntry, ForkArtifactObservation, ForkPrefixObservation } from './types';

export interface ObservationHooks {
  afterArtifactRead?: (relativePath: string) => void | Promise<void>;
}

const observeOnce = async (
  directory: string,
  throughIndex: number,
  hooks: ObservationHooks = {}
): Promise<ForkPrefixObservation> => {
  const start = await scanSelectedArtifacts(directory, throughIndex);
  const records: ForkArtifactObservation[] = [];
  for (const entry of start) {
    const hash = createHash('sha256');
    let byteLength = 0n;
    let handle: import('node:fs/promises').FileHandle | undefined;
    try {
      const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
      handle = await fsp.open(entry.sourcePath, constants.O_RDONLY | noFollow);
      if (!(await handle.stat()).isFile()) throw new Error('artifact is no longer a regular file');
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        byteLength += BigInt(chunk.byteLength);
        hash.update(chunk);
      }
    } catch (error) {
      throw new ForkError('artifact_unreadable', `unable to read selected artifact: ${entry.relativePath}`, error);
    } finally {
      try { await handle?.close(); } catch { /* read error remains primary */ }
    }
    records.push({ ...entry, byteLength, contentSha256: hash.digest() });
    await hooks.afterArtifactRead?.(entry.relativePath);
  }
  const end = await scanSelectedArtifacts(directory, throughIndex);
  if (!sameArtifactEntries(start, end)) {
    throw new ForkError('source_unstable', 'selected Conversation prefix changed during observation');
  }
  const totalBytes = records.reduce((sum, record) => sum + record.byteLength, 0n);
  const fingerprintRecords = records.map(record => ({
    relativePath: record.relativePath,
    kind: record.fileKind,
    role: record.role,
    extension: record.extension,
    byteLength: record.byteLength,
    contentSha256: record.contentSha256
  }));
  return {
    records,
    totalBytes,
    sourcePrefixFingerprint: buildConversationFingerprintTokenV1(
      digestConversationFingerprintV1(fingerprintRecords)
    )
  };
};

export const sameObservations = (left: ForkPrefixObservation, right: ForkPrefixObservation): boolean =>
  left.totalBytes === right.totalBytes && left.sourcePrefixFingerprint === right.sourcePrefixFingerprint &&
  left.records.length === right.records.length && left.records.every((item, index) => {
    const other = right.records[index];
    return other !== undefined && item.relativePath === other.relativePath && item.idx === other.idx &&
      item.fileKind === other.fileKind && item.role === other.role && item.extension === other.extension &&
      item.byteLength === other.byteLength && Buffer.from(item.contentSha256).equals(Buffer.from(other.contentSha256));
  });

export async function observeStablePrefix(
  directory: string,
  throughIndex: number,
  hooks: ObservationHooks = {}
): Promise<ForkPrefixObservation> {
  const first = await observeOnce(directory, throughIndex, hooks);
  const second = await observeOnce(directory, throughIndex, hooks);
  if (!sameObservations(first, second)) {
    throw new ForkError('source_unstable', 'selected Conversation prefix changed between observations');
  }
  return second;
}
