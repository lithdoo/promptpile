'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ConversationFingerprintError,
  fingerprintConversationDirectory
} = require('../dist/conversation-fingerprint');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fingerprint-observation-'));
const makeDirectory = name => {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  return directory;
};
const expectCode = async (promise, code) => assert.rejects(
  promise,
  error => error instanceof ConversationFingerprintError && error.code === code
);

(async () => {
  try {
    const empty = makeDirectory('empty');
    const emptyResult = await fingerprintConversationDirectory(empty);
    assert.deepStrictEqual(emptyResult, {
      schemaVersion: 1,
      fingerprintVersion: 1,
      algorithm: 'sha256',
      artifactCount: 0,
      maxIndex: null,
      fingerprint: 'promptpile-conversation-v1:sha256:498248e5b997616e75071150e4d4e28f02ef0542c5292058a21efea8fb5865ee'
    });

    const populated = makeDirectory('populated');
    fs.writeFileSync(path.join(populated, '[0]system.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x0d, 0x0a]));
    fs.writeFileSync(path.join(populated, '[1]assistant.calls.jsonl'), 'malformed JSONL is included');
    fs.writeFileSync(path.join(populated, 'ignored.txt'), 'ignored');
    fs.mkdirSync(path.join(populated, 'nested'));
    fs.writeFileSync(path.join(populated, 'nested', '[9]user.md'), 'ignored nested artifact');
    const populatedResult = await fingerprintConversationDirectory(populated);
    assert.strictEqual(populatedResult.artifactCount, 2);
    assert.strictEqual(populatedResult.maxIndex, 1);

    const aliasResult = await fingerprintConversationDirectory(path.join(root, '.', 'populated'));
    assert.strictEqual(aliasResult.fingerprint, populatedResult.fingerprint);
    fs.writeFileSync(path.join(populated, 'ignored.txt'), 'changed but still ignored');
    assert.strictEqual(
      (await fingerprintConversationDirectory(populated)).fingerprint,
      populatedResult.fingerprint
    );
    const originalTimes = fs.statSync(path.join(populated, '[0]system.md'));
    fs.utimesSync(
      path.join(populated, '[0]system.md'),
      new Date(originalTimes.atimeMs + 10_000),
      new Date(originalTimes.mtimeMs + 10_000)
    );
    assert.strictEqual(
      (await fingerprintConversationDirectory(populated)).fingerprint,
      populatedResult.fingerprint,
      'filesystem timestamps are not part of content identity'
    );
    fs.writeFileSync(path.join(populated, '[0]system.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x0a, 0x0a]));
    assert.notStrictEqual(
      (await fingerprintConversationDirectory(populated)).fingerprint,
      populatedResult.fingerprint,
      'raw BOM/line-ending bytes participate in the fingerprint'
    );

    const between = makeDirectory('between-observations');
    const betweenFile = path.join(between, '[0]user.md');
    fs.writeFileSync(betweenFile, 'AAAA');
    await expectCode(fingerprintConversationDirectory(between, {
      hooks: {
        afterObservation(ordinal) {
          if (ordinal === 1) fs.writeFileSync(betweenFile, 'BBBB');
        }
      }
    }), 'unstable_observation');

    const during = makeDirectory('during-observation');
    fs.writeFileSync(path.join(during, '[0]user.md'), 'user');
    await expectCode(fingerprintConversationDirectory(during, {
      hooks: {
        afterScanStart(ordinal) {
          if (ordinal === 1) fs.writeFileSync(path.join(during, '[1]assistant.md'), 'new');
        }
      }
    }), 'unstable_observation');

    const deleted = makeDirectory('deleted-between-observations');
    const deletedFile = path.join(deleted, '[0]user.md');
    fs.writeFileSync(deletedFile, 'delete me');
    await expectCode(fingerprintConversationDirectory(deleted, {
      hooks: {
        afterObservation(ordinal) {
          if (ordinal === 1) fs.unlinkSync(deletedFile);
        }
      }
    }), 'unstable_observation');

    const renamed = makeDirectory('renamed-between-observations');
    const oldName = path.join(renamed, '[1]user.md');
    const newName = path.join(renamed, '[01]user.md');
    fs.writeFileSync(oldName, 'same bytes');
    await expectCode(fingerprintConversationDirectory(renamed, {
      hooks: {
        afterObservation(ordinal) {
          if (ordinal === 1) fs.renameSync(oldName, newName);
        }
      }
    }), 'unstable_observation');

    const unreadableDuringRead = makeDirectory('unreadable-during-read');
    const removedArtifact = path.join(unreadableDuringRead, '[0]user.md');
    fs.writeFileSync(removedArtifact, 'cannot skip me');
    await expectCode(fingerprintConversationDirectory(unreadableDuringRead, {
      hooks: {
        afterScanStart(ordinal) {
          if (ordinal === 1) fs.unlinkSync(removedArtifact);
        }
      }
    }), 'artifact_unreadable');

    const restored = makeDirectory('restored');
    const restoredFile = path.join(restored, '[0]user.md');
    fs.writeFileSync(restoredFile, 'original');
    const baseline = await fingerprintConversationDirectory(restored);
    const restoredResult = await fingerprintConversationDirectory(restored, {
      hooks: {
        afterObservation(ordinal) {
          if (ordinal === 1) fs.writeFileSync(restoredFile, 'temporary');
        },
        afterScanStart(ordinal) {
          if (ordinal === 2) fs.writeFileSync(restoredFile, 'original');
        }
      }
    });
    assert.strictEqual(restoredResult.fingerprint, baseline.fingerprint);

    const unreadable = makeDirectory('unreadable');
    fs.writeFileSync(path.join(unreadable, '[0]user.md'), 'secret body');
    await expectCode(fingerprintConversationDirectory(unreadable, {
      openArtifact: async function* () {
        throw new Error('injected read failure');
      }
    }), 'artifact_unreadable');

    await expectCode(
      fingerprintConversationDirectory(path.join(root, 'missing')),
      'invalid_directory'
    );
    const regularFile = path.join(root, 'regular-file');
    fs.writeFileSync(regularFile, 'not a directory');
    await expectCode(fingerprintConversationDirectory(regularFile), 'invalid_directory');

    console.log('conversation fingerprint stable observation tests ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
