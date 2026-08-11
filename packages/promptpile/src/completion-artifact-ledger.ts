export type CompletionArtifactNamespace = 'main' | 'conversation' | 'receipt';
export type CompletionArtifactKind = 'body' | 'calls' | 'extra' | 'receipt';

export interface CompletionArtifactRef {
  namespace: CompletionArtifactNamespace;
  kind: CompletionArtifactKind;
  absolutePath: string;
}

export class CompletionArtifactLedger {
  private readonly committed: CompletionArtifactRef[] = [];
  private readonly byKey = new Map<string, CompletionArtifactRef>();

  private key(namespace: CompletionArtifactNamespace, kind: CompletionArtifactKind): string {
    return `${namespace}\u0000${kind}`;
  }

  record(ref: CompletionArtifactRef): void {
    const key = this.key(ref.namespace, ref.kind);
    if (this.byKey.has(key)) {
      throw new Error(`duplicate completion artifact ledger key: ${ref.namespace}/${ref.kind}`);
    }
    const committed = Object.freeze({ ...ref });
    this.committed.push(committed);
    this.byKey.set(key, committed);
  }

  entries(): readonly CompletionArtifactRef[] {
    return this.committed.slice();
  }

  find(namespace: CompletionArtifactNamespace, kind: CompletionArtifactKind): CompletionArtifactRef | undefined {
    return this.byKey.get(this.key(namespace, kind));
  }
}
