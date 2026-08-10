import path from 'path';
import { scanDirectory } from './file-handler';
import type { FileInfo } from './types';

export type ConversationArtifactKind =
  | 'message'
  | 'assistant_call'
  | 'assistant_extra'
  | 'assistant_result';

export type ConversationInspectFormat = 'text' | 'json';

export interface ConversationArtifact {
  index: number;
  kind: ConversationArtifactKind;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  path: string;
}

export interface ConversationInspection {
  schemaVersion: 1;
  /** Caller-supplied display/correlation string; never a canonical directory identity. */
  directory: string;
  artifactCount: number;
  maxIndex: number | null;
  artifacts: ConversationArtifact[];
}

const toProtocolPath = (relativePath: string): string =>
  relativePath.split(path.sep).join('/');

/** Map one scanner result without parsing, sorting, merging, or reading artifact contents. */
const buildSingleDirectoryInspection = (
  displayDirectory: string,
  files: readonly FileInfo[]
): ConversationInspection => {
  const artifacts = files.map(file => ({
    index: file.idx,
    kind: file.fileKind,
    role: file.role,
    extension: file.extension,
    path: toProtocolPath(file.relativePath)
  }));
  const maxIndex = artifacts.reduce<number | null>(
    (maximum, artifact) => maximum === null || artifact.index > maximum
      ? artifact.index
      : maximum,
    null
  );

  return {
    schemaVersion: 1,
    directory: displayDirectory,
    artifactCount: artifacts.length,
    maxIndex,
    artifacts
  };
};

/** Inspect one physical Conversation directory using the existing scanner. */
export const inspectConversation = (
  resolvedDirectory: string,
  displayDirectory: string
): ConversationInspection =>
  buildSingleDirectoryInspection(displayDirectory, scanDirectory(resolvedDirectory));

export const formatConversationInspectionJson = (
  inspection: ConversationInspection
): string => `${JSON.stringify(inspection, null, 2)}\n`;

export const formatConversationInspectionText = (
  inspection: ConversationInspection
): string => {
  const lines = [
    `Conversation: ${inspection.directory}`,
    `Artifacts: ${inspection.artifactCount}`,
    `Max index: ${inspection.maxIndex === null ? 'null' : inspection.maxIndex}`,
    ''
  ];

  for (const artifact of inspection.artifacts) {
    lines.push([
      `[${artifact.index}]`.padEnd(4),
      artifact.kind.padEnd(16),
      artifact.role.padEnd(10),
      artifact.extension.padEnd(6),
      artifact.path
    ].join(' '));
  }

  return `${lines.join('\n')}\n`;
};
