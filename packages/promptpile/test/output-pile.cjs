'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.join(__dirname, '..');
const {
  createOutputPileWriter,
  parseOutputPileFd,
  parseOutputPileFormat
} = require(path.join(root, 'dist', 'output-pile.js'));

(async () => {
  assert.strictEqual(parseOutputPileFormat(undefined), undefined);
  assert.strictEqual(parseOutputPileFormat(''), undefined);
  assert.strictEqual(parseOutputPileFormat('text'), 'text');
  assert.strictEqual(parseOutputPileFormat('json'), 'json');
  assert.throws(() => parseOutputPileFormat('yaml'), /text or json/);

  assert.strictEqual(parseOutputPileFd(undefined), undefined);
  assert.strictEqual(parseOutputPileFd(''), undefined);
  assert.strictEqual(parseOutputPileFd('3'), 3);
  assert.strictEqual(parseOutputPileFd(4), 4);
  assert.throws(() => parseOutputPileFd('2'), />= 3/);
  assert.throws(() => parseOutputPileFd('3.5'), />= 3/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-output-pile-'));
  try {
    const textPath = path.join(tmp, 'stream.txt');
    const textWriter = createOutputPileWriter({ pileFile: textPath, format: 'text' });
    textWriter.writeDelta('hello');
    textWriter.writeDelta(' world');
    textWriter.writeDone();
    await textWriter.close();
    assert.strictEqual(fs.readFileSync(textPath, 'utf8'), 'hello world');

    const jsonPath = path.join(tmp, 'stream.jsonl');
    const jsonWriter = createOutputPileWriter({ pileFile: jsonPath, format: 'json' });
    jsonWriter.writeDelta('hello');
    jsonWriter.writeDone();
    await jsonWriter.close();
    const lines = fs.readFileSync(jsonPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepStrictEqual(lines, [
      { type: 'assistant_delta', content: 'hello' },
      { type: 'assistant_done' }
    ]);

    const fdPath = path.join(tmp, 'fd.jsonl');
    const fd = fs.openSync(fdPath, 'w');
    const fdWriter = createOutputPileWriter({ pileFd: fd, format: 'json' });
    fdWriter.writeDelta('fd hello');
    fdWriter.writeDone();
    await fdWriter.close();
    const fdLines = fs.readFileSync(fdPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepStrictEqual(fdLines, [
      { type: 'assistant_delta', content: 'fd hello' },
      { type: 'assistant_done' }
    ]);

    const fdWinsPath = path.join(tmp, 'fd-wins.txt');
    const ignoredPath = path.join(tmp, 'ignored.txt');
    const fdWins = fs.openSync(fdWinsPath, 'w');
    const fdWinsWriter = createOutputPileWriter({
      pileFile: ignoredPath,
      pileFd: fdWins,
      format: 'text'
    });
    fdWinsWriter.writeDelta('fd wins');
    await fdWinsWriter.close();
    assert.strictEqual(fs.readFileSync(fdWinsPath, 'utf8'), 'fd wins');
    assert.strictEqual(fs.existsSync(ignoredPath), false, 'fd target wins over file target');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('output-pile tests ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
