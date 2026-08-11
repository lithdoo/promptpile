import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConversationConflictError } from './conversation-conflict';
import type { ConversationMutationKind } from './conversation-index';
import { recordSecondaryFailure } from './primary-failure';

export const CONVERSATION_CLAIM_FILENAME = '.promptpile.occ.claim';

interface ConversationClaimMetadata {
  schemaVersion: 1;
  token: string;
  pid: number;
  host: string;
  createdAt: string;
  operation: ConversationMutationKind;
}

export interface ConversationMutationClaim {
  path: string;
  ownerToken: string;
}

export interface ConversationClaimDependencies {
  openExclusive?: (claimPath: string) => number;
  write?: (fd: number, content: string) => void;
  close?: (fd: number) => void;
  read?: (claimPath: string) => string;
  unlink?: (claimPath: string) => void;
  ownerToken?: () => string;
  now?: () => Date;
  host?: () => string;
  pid?: number;
}

const defaultOpenExclusive = (claimPath: string): number =>
  fs.openSync(claimPath, 'wx', 0o600);

export const acquireConversationMutationClaim = (
  directory: string,
  operation: ConversationMutationKind,
  dependencies: ConversationClaimDependencies = {}
): ConversationMutationClaim => {
  const claimPath = path.join(directory, CONVERSATION_CLAIM_FILENAME);
  const ownerToken = (dependencies.ownerToken ?? (() => crypto.randomUUID()))();
  const metadata: ConversationClaimMetadata = {
    schemaVersion: 1,
    token: ownerToken,
    pid: dependencies.pid ?? process.pid,
    host: (dependencies.host ?? os.hostname)(),
    createdAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    operation
  };

  let fd: number;
  try {
    fd = (dependencies.openExclusive ?? defaultOpenExclusive)(claimPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      throw new ConversationConflictError(
        'claim_busy',
        'another writer owns the Conversation mutation claim',
        { claimPath }
      );
    }
    throw error;
  }

  let closed = false;
  try {
    (dependencies.write ?? ((targetFd, content) => fs.writeFileSync(targetFd, content, 'utf8')))(
      fd,
      `${JSON.stringify(metadata)}\n`
    );
    (dependencies.close ?? fs.closeSync)(fd);
    closed = true;
    return { path: claimPath, ownerToken };
  } catch (error) {
    if (!closed) {
      try { (dependencies.close ?? fs.closeSync)(fd); } catch { /* preserve acquisition failure */ }
    }
    try { (dependencies.unlink ?? fs.unlinkSync)(claimPath); } catch { /* best effort */ }
    throw error;
  }
};

export const releaseConversationMutationClaim = (
  claim: ConversationMutationClaim,
  dependencies: ConversationClaimDependencies = {}
): void => {
  const raw = (dependencies.read ?? ((claimPath: string) => fs.readFileSync(claimPath, 'utf8')))(
    claim.path
  );
  let token: unknown;
  try {
    token = (JSON.parse(raw) as { token?: unknown }).token;
  } catch (error) {
    throw new Error(
      `unable to verify Conversation claim owner before cleanup: ${claim.path}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (token !== claim.ownerToken) {
    throw new Error(`refusing to release Conversation claim owned by another writer: ${claim.path}`);
  }
  (dependencies.unlink ?? fs.unlinkSync)(claim.path);
};

export const withConversationMutationClaim = async <T>(
  directory: string,
  operation: ConversationMutationKind,
  callback: (claim: ConversationMutationClaim) => T | Promise<T>,
  dependencies: ConversationClaimDependencies = {}
): Promise<T> => {
  const claim = acquireConversationMutationClaim(directory, operation, dependencies);
  let callbackCompleted = false;
  let hasPrimaryFailure = false;
  let primaryFailure: unknown;
  let value!: T;
  try {
    value = await callback(claim);
    callbackCompleted = true;
  } catch (error) {
    hasPrimaryFailure = true;
    primaryFailure = error;
  }
  try {
    releaseConversationMutationClaim(claim, dependencies);
  } catch (cleanupError) {
    const cleanupFailure = new Error(
      `${callbackCompleted ? 'mutation committed; ' : ''}Conversation claim cleanup failed: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`
    );
    if (hasPrimaryFailure) recordSecondaryFailure(primaryFailure, cleanupFailure);
    else throw cleanupFailure;
  }
  if (hasPrimaryFailure) throw primaryFailure;
  return value;
};
