'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const packageRoot = path.join(__dirname, '..');
const helper = path.join(__dirname, 'helpers', 'occ-claim-contender.cjs');
const { fingerprintConversationDirectory } = require(path.join(
  packageRoot,
  'dist',
  'conversation-fingerprint.js'
));

const spawnContender = (directory, fingerprint, content) => {
  const child = fork(helper, [directory, fingerprint, '0', content], {
    cwd: packageRoot,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  return { child, stderr: () => stderr };
};

const waitForMessage = (child, predicate, label) => {
  let cleanup = () => {};
  const promise = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    cleanup();
    reject(new Error(`timed out waiting for ${label}`));
  }, 10_000);
  const onMessage = message => {
    if (message?.type === 'fatal') {
      cleanup();
      reject(new Error(message.message));
      return;
    }
    if (!predicate(message)) return;
    cleanup();
    resolve(message);
  };
  const onExit = code => {
    cleanup();
    reject(new Error(`contender exited with code ${code} before ${label}`));
  };
  cleanup = () => {
    clearTimeout(timeout);
    child.off('message', onMessage);
    child.off('exit', onExit);
  };
  child.on('message', onMessage);
  child.on('exit', onExit);
  });
  promise.cancel = cleanup;
  return promise;
};

const waitForExit = child => new Promise((resolve, reject) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolve({ code: child.exitCode, signal: child.signalCode });
    return;
  }
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-claim-contention-'));
  let a;
  let b;
  try {
    const fingerprint = (await fingerprintConversationDirectory(directory)).fingerprint;
    a = spawnContender(directory, fingerprint, 'writer a');
    b = spawnContender(directory, fingerprint, 'writer b');

    const readyA = waitForMessage(a.child, message => message?.type === 'ready', 'A ready');
    const readyB = waitForMessage(b.child, message => message?.type === 'ready', 'B ready');
    await Promise.all([readyA, readyB]);

    const enteredA = waitForMessage(a.child, message => message?.type === 'entered', 'A entered');
    const enteredB = waitForMessage(b.child, message => message?.type === 'entered', 'B entered');
    const resultA = waitForMessage(a.child, message => message?.type === 'result', 'A result');
    const resultB = waitForMessage(b.child, message => message?.type === 'result', 'B result');

    a.child.send({ type: 'go' });
    b.child.send({ type: 'go' });

    const winner = await Promise.race([
      enteredA.then(() => ({ contender: a, result: resultA, otherEntered: enteredB, otherResult: resultB })),
      enteredB.then(() => ({ contender: b, result: resultB, otherEntered: enteredA, otherResult: resultA }))
    ]);

    const loserOutcome = await Promise.race([
      winner.otherEntered.then(() => ({ type: 'entered' })),
      winner.otherResult.then(result => ({ type: 'result', result }))
    ]);
    assert.strictEqual(
      loserOutcome.type,
      'result',
      'both contenders entered the mutation critical section while the winner held the claim'
    );
    winner.otherEntered.cancel();
    assert.deepStrictEqual(
      { status: loserOutcome.result.status, kind: loserOutcome.result.kind },
      { status: 'conflict', kind: 'claim_busy' }
    );
    assert.ok(
      fs.existsSync(path.join(directory, '.promptpile.occ.claim')),
      'winner must still own the claim when the loser reports claim_busy'
    );

    winner.contender.child.send({ type: 'release' });
    const winnerResult = await winner.result;
    assert.strictEqual(winnerResult.status, 'success');

    const exits = await Promise.all([waitForExit(a.child), waitForExit(b.child)]);
    assert.deepStrictEqual(exits.map(exit => exit.code), [0, 0], `${a.stderr()}\n${b.stderr()}`);
    assert.strictEqual(
      fs.readdirSync(directory).filter(name => /^\[\d+\]user\.md$/.test(name)).length,
      1
    );
    assert.ok(!fs.existsSync(path.join(directory, '.promptpile.occ.claim')));
    console.log('Conversation atomic claim contention tests ok');
  } finally {
    for (const contender of [a, b]) {
      if (contender?.child.exitCode === null) contender.child.kill();
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
