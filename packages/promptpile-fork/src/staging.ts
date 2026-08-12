import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ForkError } from './errors';
import { observeStablePrefix, sameObservations } from './observation';
import type { ForkPrefixObservation, ResolvedForkPaths } from './types';

export async function createStaging(resolved: ResolvedForkPaths): Promise<string> {
  try {
    return await fs.mkdtemp(path.join(resolved.targetParent, '.promptpile-fork.staging.'));
  } catch (error) {
    throw new ForkError('staging_create_failed', 'unable to create private staging directory', error);
  }
}

export async function copyBaselineToStaging(
  baseline: ForkPrefixObservation,
  staging: string,
  afterEachCopy?: (relativePath: string) => void | Promise<void>
): Promise<void> {
  for (const record of baseline.records) {
    const destination = path.join(staging, record.relativePath);
    if (path.dirname(destination) !== staging) {
      throw new ForkError('staging_write_failed', `unsafe artifact basename: ${record.relativePath}`);
    }
    let sourceHandle: import('node:fs/promises').FileHandle | undefined;
    let destinationHandle: import('node:fs/promises').FileHandle | undefined;
    try {
      const sourceEntry = await fs.lstat(record.sourcePath);
      if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) {
        throw new Error('source artifact is no longer a direct regular file');
      }
      const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
      sourceHandle = await fs.open(record.sourcePath, constants.O_RDONLY | noFollow);
      if (!(await sourceHandle.stat()).isFile()) throw new Error('source artifact is no longer regular');
      destinationHandle = await fs.open(destination, 'wx', 0o600);
      const hash = createHash('sha256');
      let byteLength = 0n;
      const buffer = Buffer.allocUnsafe(64 * 1024);
      while (true) {
        const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.byteLength, null);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        byteLength += BigInt(bytesRead);
        hash.update(chunk);
        let offset = 0;
        while (offset < bytesRead) {
          const result = await destinationHandle.write(chunk, offset, bytesRead - offset, null);
          if (result.bytesWritten === 0) throw new Error('staging write made no progress');
          offset += result.bytesWritten;
        }
      }
      if (byteLength !== record.byteLength ||
        !hash.digest().equals(Buffer.from(record.contentSha256))) {
        throw new ForkError('source_unstable', `selected artifact changed while copying: ${record.relativePath}`);
      }
    } catch (error) {
      if (error instanceof ForkError) throw error;
      throw new ForkError('staging_write_failed', `unable to copy selected artifact: ${record.relativePath}`, error);
    } finally {
      try { await sourceHandle?.close(); } catch { /* primary result wins */ }
      try { await destinationHandle?.close(); } catch { /* staging verification remains authoritative */ }
    }
    await afterEachCopy?.(record.relativePath);
  }
}

export async function verifyStaging(
  staging: string,
  throughIndex: number,
  baseline: ForkPrefixObservation
): Promise<void> {
  let observed: ForkPrefixObservation;
  try { observed = await observeStablePrefix(staging, throughIndex); } catch (error) {
    throw new ForkError('staging_verify_failed', 'unable to verify staged Conversation prefix', error);
  }
  if (!sameObservations(baseline, observed)) {
    throw new ForkError('staging_verify_failed', 'staged Conversation prefix does not match source baseline');
  }
}

export async function cleanupStaging(staging: string): Promise<void> {
  await fs.rm(staging, { recursive: true, force: true });
}
