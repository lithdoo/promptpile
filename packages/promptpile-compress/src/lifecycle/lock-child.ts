import { withDirectoryLifecycleLock } from './lock';

const directory = process.argv[2];

const send = (message: Record<string, unknown>): void => {
  process.send?.(message);
};

const waitForRelease = (): Promise<void> =>
  new Promise((resolve) => {
    process.once('message', (message) => {
      if (message === 'release') resolve();
    });
  });

process.once('message', async (message) => {
  if (message !== 'start') return;
  try {
    await withDirectoryLifecycleLock(directory, 'compress', async () => {
      send({ type: 'entered', pid: process.pid });
      await waitForRelease();
    });
    send({ type: 'completed', pid: process.pid });
  } catch (error) {
    send({
      type: 'error',
      pid: process.pid,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
