import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  createTiktokenTokenizer,
  estimateTextTokens,
  heuristicTokenizer,
} from './tokenizer';

interface Corpus {
  reference: { adapter: string; model: string };
  samples: Array<{ name: string; content: string; expectedTokens: number }>;
}

const corpus = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../fixtures/tokenizer-benchmark-v1/corpus.json'
    ),
    'utf8'
  )
) as Corpus;

describe('tokenizer adapters', () => {
  it('matches the versioned tiktoken reference corpus exactly', async () => {
    const tokenizer = await createTiktokenTokenizer(corpus.reference.model);
    try {
      assert.equal(tokenizer.id, corpus.reference.adapter);
      assert.equal(tokenizer.model, corpus.reference.model);
      assert.equal(tokenizer.kind, 'exact');
      for (const sample of corpus.samples) {
        assert.equal(
          tokenizer.countText(sample.content),
          sample.expectedTokens,
          sample.name
        );
      }
    } finally {
      tokenizer.dispose?.();
    }
  });

  it('keeps the heuristic fallback explicit and within its measured bound', () => {
    assert.equal(heuristicTokenizer.id, 'promptpile-unicode-heuristic-v1');
    assert.equal(heuristicTokenizer.model, 'model-agnostic');
    assert.equal(heuristicTokenizer.kind, 'heuristic-fallback');
    for (const sample of corpus.samples) {
      const actual = heuristicTokenizer.countText(sample.content);
      const relativeError =
        Math.abs(actual - sample.expectedTokens) / sample.expectedTokens;
      assert.ok(relativeError <= 0.5, `${sample.name}: ${relativeError}`);
    }
  });

  it('fails clearly for an unsupported exact model without hiding fallback', async () => {
    await assert.rejects(
      createTiktokenTokenizer('not-a-real-model'),
      /unsupported tiktoken model/
    );
    assert.ok(heuristicTokenizer.countText('fallback remains explicit') > 0);
  });

  it('rejects invalid custom adapter counts', () => {
    assert.throws(
      () =>
        estimateTextTokens('content', {
          id: 'broken-v1',
          model: 'fixture',
          kind: 'exact',
          messageOverheadTokens: 0,
          countText: () => -1,
        }),
      /invalid token count/
    );
  });
});
