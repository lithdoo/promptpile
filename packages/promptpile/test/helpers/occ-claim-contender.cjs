'use strict';

const path = require('path');

const packageRoot = path.join(__dirname, '..', '..');
const {
  commitConversationMutation,
  preflightConversationMutation
} = require(path.join(packageRoot, 'dist', 'conversation-mutation-guard.js'));
const { appendUserMessageAtIndex } = require(path.join(packageRoot, 'dist', 'file-handler.js'));

const [directory, expectedFingerprint, expectedNextIndexRaw, content] = process.argv.slice(2);
const precondition = {
  expectedFingerprint,
  expectedNextIndex: Number(expectedNextIndexRaw)
};

const waitForCommand = command => new Promise(resolve => {
  const handler = message => {
    if (message?.type !== command) return;
    process.off('message', handler);
    resolve();
  };
  process.on('message', handler);
});

const send = message => {
  if (process.send) process.send(message);
};

(async () => {
  await preflightConversationMutation(directory, 'append_user', precondition);
  send({ type: 'ready' });
  await waitForCommand('go');

  try {
    const committed = await commitConversationMutation({
      directory,
      mutationKind: 'append_user',
      precondition,
      mutate: async state => {
        send({ type: 'entered' });
        await waitForCommand('release');
        return appendUserMessageAtIndex(directory, state.nextIndex, content);
      }
    });
    send({ type: 'result', status: 'success', path: committed.value });
  } catch (error) {
    send({
      type: 'result',
      status: error?.code === 'conversation_conflict' ? 'conflict' : 'error',
      kind: error?.kind,
      message: error instanceof Error ? error.message : String(error)
    });
  }
})().catch(error => {
  send({
    type: 'fatal',
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
