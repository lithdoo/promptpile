export type CompletionArtifactNamespace = 'main' | 'conversation' | 'receipt';
export type CompletionArtifactKind = 'body' | 'calls' | 'extra' | 'receipt';

export interface CompletionArtifactRef {
  namespace: CompletionArtifactNamespace;
  kind: CompletionArtifactKind;
  absolutePath: string;
}

export class CompletionArtifactLedger {
  private readonly committed: CompletionArtifactRef[] = [];

  record(ref: CompletionArtifactRef): void {
    this.committed.push(Object.freeze({ ...ref }));
  }

  entries(): readonly CompletionArtifactRef[] {
    return this.committed.slice();
  }

  find(namespace: CompletionArtifactNamespace, kind: CompletionArtifactKind): CompletionArtifactRef | undefined {
    return this.committed.find(ref => ref.namespace === namespace && ref.kind === kind);
  }
}
