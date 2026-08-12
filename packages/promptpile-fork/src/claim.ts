import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ForkError } from './errors';
import type { ResolvedForkPaths } from './types';

export interface TargetClaim { path: string; }

export async function acquireTargetClaim(resolved: ResolvedForkPaths): Promise<TargetClaim> {
  const digest = createHash('sha256').update(resolved.canonicalTargetIdentity, 'utf8').digest('hex');
  const claimPath = path.join(resolved.targetParent, `.promptpile-fork.claim.${digest}`);
  let handle: import('node:fs/promises').FileHandle | undefined;
  let created = false;
  try {
    handle = await fs.open(claimPath, 'wx', 0o600);
    created = true;
    await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, pid: process.pid, target: resolved.target })}\n`, 'utf8');
  } catch (error) {
    try { await handle?.close(); } catch { /* primary error wins */ }
    if (created) {
      try { await fs.unlink(claimPath); } catch { /* absent or cleanup failure; primary error wins */ }
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ForkError('target_claimed', `target is claimed by another fork: ${resolved.target}`, error);
    }
    throw new ForkError('target_claimed', `unable to acquire target claim: ${resolved.target}`, error);
  }
  try { await handle.close(); } catch (error) {
    try { await fs.unlink(claimPath); } catch { /* primary error wins */ }
    throw new ForkError('target_claimed', `unable to finalize target claim: ${resolved.target}`, error);
  }
  return { path: claimPath };
}

export async function releaseTargetClaim(claim: TargetClaim): Promise<void> {
  await fs.unlink(claim.path);
}
