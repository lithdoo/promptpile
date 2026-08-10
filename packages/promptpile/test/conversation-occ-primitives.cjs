const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const {
  acquireConversationMutationClaim,
  releaseConversationMutationClaim,
  withConversationMutationClaim,
  CONVERSATION_CLAIM_FILENAME
} = require(path.join(dist, 'conversation-mutation-claim.js'));
const {
  parseConversationFingerprintTokenV1,
  fingerprintConversationDirectory
} = require(path.join(dist, 'conversation-fingerprint.js'));
const {
  parseExpectedConversationIndex,
  MAX_CONVERSATION_INDEX
} = require(path.join(dist, 'conversation-index.js'));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-occ-primitives-'));
  try {
    assert.strictEqual(parseExpectedConversationIndex('0'), 0);
    assert.strictEqual(
      parseExpectedConversationIndex(String(MAX_CONVERSATION_INDEX)),
      MAX_CONVERSATION_INDEX
    );
    assert.strictEqual(parseExpectedConversationIndex('01'), 1);
    for (const invalid of ['-1', '1.5', '1e2', '+1', '9007199254740992']) {
      assert.throws(() => parseExpectedConversationIndex(invalid));
    }

    const emptyFingerprint = await fingerprintConversationDirectory(root);
    assert.strictEqual(
      parseConversationFingerprintTokenV1(emptyFingerprint.fingerprint),
      emptyFingerprint.fingerprint
    );
    assert.throws(() => parseConversationFingerprintTokenV1(emptyFingerprint.fingerprint.toUpperCase()));

    const first = acquireConversationMutationClaim(root, 'append_user', {
      ownerToken: () => 'owner-one'
    });
    assert.throws(
      () => acquireConversationMutationClaim(root, 'append_user'),
      error => error.kind === 'claim_busy'
    );
    assert.strictEqual(
      (await fingerprintConversationDirectory(root)).fingerprint,
      emptyFingerprint.fingerprint,
      'claim control file must not affect fingerprints'
    );

    const raw = JSON.parse(fs.readFileSync(first.path, 'utf8'));
    raw.token = 'other-owner';
    fs.writeFileSync(first.path, `${JSON.stringify(raw)}\n`);
    assert.throws(() => releaseConversationMutationClaim(first), /another writer/);
    assert.ok(fs.existsSync(first.path), 'wrong-owner release must preserve the claim');
    raw.token = first.ownerToken;
    fs.writeFileSync(first.path, `${JSON.stringify(raw)}\n`);
    releaseConversationMutationClaim(first);

    await assert.rejects(
      withConversationMutationClaim(
        root,
        'append_user',
        async () => 'committed',
        { unlink: () => { throw new Error('injected unlink failure'); } }
      ),
      /mutation committed; Conversation claim cleanup failed/
    );
    fs.unlinkSync(path.join(root, CONVERSATION_CLAIM_FILENAME));

    await assert.rejects(
      withConversationMutationClaim(root, 'append_user', async () => {
        throw new Error('mutation failure');
      }),
      /mutation failure/
    );
    assert.ok(!fs.existsSync(path.join(root, CONVERSATION_CLAIM_FILENAME)));

    const crash = require('child_process').spawnSync(process.execPath, [
      '-e',
      `require(${JSON.stringify(path.join(dist, 'conversation-mutation-claim.js'))})` +
        `.acquireConversationMutationClaim(${JSON.stringify(root)},'append_user');process.exit(0)`
    ], { encoding: 'utf8' });
    assert.strictEqual(crash.status, 0, crash.stderr);
    assert.ok(fs.existsSync(path.join(root, CONVERSATION_CLAIM_FILENAME)));
    assert.throws(
      () => acquireConversationMutationClaim(root, 'append_user'),
      error => error.kind === 'claim_busy'
    );
    fs.unlinkSync(path.join(root, CONVERSATION_CLAIM_FILENAME));
    console.log('conversation OCC primitive tests ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
