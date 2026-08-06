const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { searchArchive } = require('../dist/index.js');

const ITERATIONS = Number.parseInt(
  process.env.PPCGS_BENCHMARK_ITERATIONS || '3',
  10
);
const THOUSAND_TURNS = Number.parseInt(
  process.env.PPCGS_BENCHMARK_TURNS || '1000',
  10
);
const LARGE_JSONL_TURNS = Number.parseInt(
  process.env.PPCGS_BENCHMARK_JSONL_TURNS || '64',
  10
);
const LARGE_JSONL_BYTES = Number.parseInt(
  process.env.PPCGS_BENCHMARK_JSONL_BYTES || '65536',
  10
);
const CHECK = process.argv.includes('--check');

const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};

const round = (value) => Number(value.toFixed(2));

const createArchive = (root, turnCount, contentsForTurn) => {
  const archive = path.join(root, `[${turnCount}]system.md.archive`);
  fs.mkdirSync(archive);
  const indices = Array.from({ length: turnCount }, (_, index) => index + 1);
  fs.writeFileSync(
    path.join(archive, 'compression.json'),
    JSON.stringify({ version: 1, archivedTurnIndices: indices })
  );
  let bytes = 0;
  let bytesWithoutResults = 0;
  let artifacts = 0;
  let artifactsWithoutResults = 0;
  for (const turnIdx of indices) {
    for (const [suffix, content] of contentsForTurn(turnIdx)) {
      fs.writeFileSync(path.join(archive, `[${turnIdx}]${suffix}`), content);
      bytes += Buffer.byteLength(content);
      artifacts += 1;
      if (suffix !== 'assistant.result.jsonl') {
        bytesWithoutResults += Buffer.byteLength(content);
        artifactsWithoutResults += 1;
      }
    }
  }
  return {
    bytes,
    bytesWithoutResults,
    artifacts,
    artifactsWithoutResults,
  };
};

const snapshotArchive = (directory) =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const content = fs.readFileSync(path.join(directory, entry.name));
      return `${entry.name}:${crypto.createHash('sha256').update(content).digest('hex')}`;
    });

const measure = async (action) => {
  if (global.gc) global.gc();
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 2);
  const started = performance.now();
  try {
    const result = await action();
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    return {
      durationMs: performance.now() - started,
      peakRssDeltaMiB: (peakRss - baselineRss) / 1024 / 1024,
      result,
    };
  } finally {
    clearInterval(sampler);
  }
};

const sample = async (iterations, action) => {
  const values = [];
  let peakRssDeltaMiB = 0;
  for (let index = 0; index < iterations; index += 1) {
    const measured = await measure(action);
    values.push(measured.durationMs);
    peakRssDeltaMiB = Math.max(
      peakRssDeltaMiB,
      measured.peakRssDeltaMiB
    );
  }
  return {
    medianMs: percentile(values, 0.5),
    p90Ms: percentile(values, 0.9),
    peakRssDeltaMiB,
  };
};

const benchmarkScenario = async ({
  name,
  turnCount,
  contentsForTurn,
  query,
  includeToolResults = false,
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ppcgs-${name}-`));
  try {
    const corpus = createArchive(root, turnCount, contentsForTurn);
    const archive = path.join(root, `[${turnCount}]system.md.archive`);
    const before = snapshotArchive(archive);
    const first = await measure(() =>
      searchArchive(root, { query, includeToolResults })
    );
    const warm = await sample(ITERATIONS, () =>
      searchArchive(root, { query, includeToolResults })
    );
    const after = snapshotArchive(archive);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`${name}: benchmark mutated archive entries`);
    }
    const searchableBytes = includeToolResults
      ? corpus.bytes
      : corpus.bytesWithoutResults;
    const searchableArtifacts = includeToolResults
      ? corpus.artifacts
      : corpus.artifactsWithoutResults;
    return {
      turns: turnCount,
      artifacts: corpus.artifacts,
      searchableArtifacts,
      corpusMiB: round(corpus.bytes / 1024 / 1024),
      searchableMiB: round(searchableBytes / 1024 / 1024),
      firstQueryMs: round(first.durationMs),
      warmMedianMs: round(warm.medianMs),
      warmP90Ms: round(warm.p90Ms),
      throughputMiBPerSecond:
        warm.medianMs === 0
          ? null
          : round(searchableBytes / 1024 / 1024 / (warm.medianMs / 1000)),
      peakRssDeltaMiB: round(
        Math.max(first.peakRssDeltaMiB, warm.peakRssDeltaMiB)
      ),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const benchmarkEarlyLimit = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcgs-early-limit-'));
  try {
    createArchive(root, THOUSAND_TURNS, (turnIdx) => [
      ['assistant.md', `Turn ${turnIdx} shared-early-hit ${'context '.repeat(8)}`],
      ['assistant.calls.jsonl', `${JSON.stringify({ turnIdx, call: 'read' })}\n`],
      ['assistant.result.jsonl', `${JSON.stringify({ turnIdx, result: 'ok' })}\n`],
    ]);
    const samples = await sample(ITERATIONS, () =>
      searchArchive(root, { query: 'shared-early-hit', limit: 1 })
    );
    return {
      medianMs: round(samples.medianMs),
      p90Ms: round(samples.p90Ms),
      peakRssDeltaMiB: round(samples.peakRssDeltaMiB),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const run = async () => {
  for (const [name, value] of [
    ['PPCGS_BENCHMARK_ITERATIONS', ITERATIONS],
    ['PPCGS_BENCHMARK_TURNS', THOUSAND_TURNS],
    ['PPCGS_BENCHMARK_JSONL_TURNS', LARGE_JSONL_TURNS],
    ['PPCGS_BENCHMARK_JSONL_BYTES', LARGE_JSONL_BYTES],
  ]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  const small = await benchmarkScenario({
    name: 'small',
    turnCount: 25,
    contentsForTurn: (turnIdx) => [
      ['user.md', `Turn ${turnIdx}: ${'ordinary content '.repeat(8)}`],
      ['assistant.md', `Answer ${turnIdx}: ${'deterministic response '.repeat(8)}`],
    ],
    query: 'not-present-full-scan',
  });
  const thousand = await benchmarkScenario({
    name: 'thousand-turns',
    turnCount: THOUSAND_TURNS,
    contentsForTurn: (turnIdx) => [
      ['assistant.md', `Turn ${turnIdx}: ${'archive content '.repeat(12)}`],
      ['assistant.calls.jsonl', `${JSON.stringify({ turnIdx, name: 'read_file' })}\n`],
      ['assistant.result.jsonl', `${JSON.stringify({ turnIdx, status: 'ok' })}\n`],
    ],
    query: 'not-present-full-scan',
  });
  const earlyLimit = await benchmarkEarlyLimit();
  const largeJsonl = await benchmarkScenario({
    name: 'large-jsonl',
    turnCount: LARGE_JSONL_TURNS,
    contentsForTurn: (turnIdx) => [
      ['assistant.md', `Turn ${turnIdx}`],
      [
        'assistant.result.jsonl',
        `${JSON.stringify({ turnIdx, payload: 'x'.repeat(LARGE_JSONL_BYTES) })}\n`,
      ],
    ],
    query: 'not-present-full-scan',
    includeToolResults: true,
  });

  const thresholds = {
    smallFirstQueryMs: 2_000,
    thousandWarmMedianMs: 15_000,
    largeJsonlWarmMedianMs: 15_000,
    maxPeakRssDeltaMiB: 256,
    earlyLimitToFullScanRatio: 1.5,
  };
  const checks = {
    smallFirstQuery: small.firstQueryMs <= thresholds.smallFirstQueryMs,
    thousandFullScan:
      thousand.warmMedianMs <= thresholds.thousandWarmMedianMs,
    largeJsonlFullScan:
      largeJsonl.warmMedianMs <= thresholds.largeJsonlWarmMedianMs,
    peakRss:
      Math.max(
        small.peakRssDeltaMiB,
        thousand.peakRssDeltaMiB,
        earlyLimit.peakRssDeltaMiB,
        largeJsonl.peakRssDeltaMiB
      ) <= thresholds.maxPeakRssDeltaMiB,
    earlyLimit:
      earlyLimit.medianMs <=
      thousand.warmMedianMs * thresholds.earlyLimitToFullScanRatio,
  };
  const output = {
    benchmark: 'archive-literal-search-v1',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    iterations: ITERATIONS,
    scenarios: { small, thousand, earlyLimit, largeJsonl },
    thresholds,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  console.log(JSON.stringify(output, null, 2));
  if (CHECK && !output.passed) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
