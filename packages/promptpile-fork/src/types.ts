import type { ConversationArtifactFileKindV1 } from 'promptpile-protocol/conversation';

export interface ForkArtifactEntry {
  relativePath: string;
  sourcePath: string;
  idx: number;
  fileKind: ConversationArtifactFileKindV1;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
}

export interface ForkArtifactObservation extends ForkArtifactEntry {
  byteLength: bigint;
  contentSha256: Uint8Array;
}

export interface ForkPrefixObservation {
  records: ForkArtifactObservation[];
  totalBytes: bigint;
  sourcePrefixFingerprint: string;
}

export interface ResolvedForkPaths {
  source: string;
  target: string;
  targetParent: string;
  targetBasename: string;
  canonicalTargetIdentity: string;
}

export interface ForkReport {
  schemaVersion: 1;
  operation: 'conversation_fork';
  status: 'planned' | 'completed';
  source: string;
  target: string;
  throughIndex: number;
  artifactCount: number;
  totalBytes: number;
  sourcePrefixFingerprint: string;
}
