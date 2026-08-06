const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { scanTurns } = require('../dist/compress/scanner.js');
const { heuristicTokenizer } = require('../dist/compress/tokenizer.js');

const TURN_COUNT = Number.parseInt(process.env.PPC_BENCHMARK_TURNS || '1000', 10);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-scan-benchmark-'));

const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};

const run = async () => {
  for (let idx = 1; idx <= TURN_COUNT; idx += 1) {
    fs.writeFileSync(
      path.join(root, `[${idx}]assistant.md`),
      `Turn ${idx}: ${'cached report content '.repeat(20)}`
    );
    fs.writeFileSync(
      path.join(root, `[${idx}]assistant.calls.jsonl`),
      JSON.stringify({ name: 'read_file', idx }) + '\n'
    );
    fs.writeFileSync(
      path.join(root, `[${idx}]assistant.result.jsonl`),
      JSON.stringify({ status: 'ok', idx, lines: 240 }) + '\n'
    );
  }

  const names = fs.readdirSync(root).sort();
  const legacySamples = [];
  const currentSamples = [];
  let tokens = 0;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const started = performance.now();
    const turns = await scanTurns(root);
    currentSamples.push(performance.now() - started);
    tokens = turns.reduce((sum, turn) => sum + turn.estimatedTokens, 0);

    const legacyStarted = performance.now();
    let legacyTokens = 0;
    for (const name of names) {
      const content = await fs.promises.readFile(path.join(root, name), 'utf8');
      legacyTokens +=
        heuristicTokenizer.countText(content) +
        heuristicTokenizer.messageOverheadTokens;
    }
    await Promise.all(
      names.map((name) => fs.promises.readFile(path.join(root, name), 'utf8'))
    );
    legacySamples.push(performance.now() - legacyStarted);
    if (legacyTokens !== tokens) throw new Error('benchmark token totals diverged');
  }
  const currentMedianMs = percentile(currentSamples, 0.5);
  const legacyMedianMs = percentile(legacySamples, 0.5);
  console.log(
    JSON.stringify(
      {
        benchmark: 'parallel-cached-scan-v1',
        turns: TURN_COUNT,
        artifacts: TURN_COUNT * 3,
        tokenizer: 'promptpile-unicode-heuristic-v1',
        currentMedianMs: Number(currentMedianMs.toFixed(2)),
        currentP90Ms: Number(percentile(currentSamples, 0.9).toFixed(2)),
        legacyTwoPassMedianMs: Number(legacyMedianMs.toFixed(2)),
        speedup: Number((legacyMedianMs / currentMedianMs).toFixed(2)),
        estimatedTokens: tokens,
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));
