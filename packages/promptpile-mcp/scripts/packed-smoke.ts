import assert from 'node:assert/strict';
import path from 'node:path';
import { PACKAGE_VERSION } from '../src/version';
import { runCompositionWitness } from './composition-witness';
import { createFreshConsumer, runProcess } from './fresh-consumer';

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(__dirname, '../../../..');
  const consumer = createFreshConsumer(repositoryRoot);
  try {
    const mcpBin = path.join(
      consumer.binDirectory,
      process.platform === 'win32' ? 'promptpile-mcp.cmd' : 'promptpile-mcp'
    );
    assert.equal(runProcess(mcpBin, ['--version'], consumer.root), PACKAGE_VERSION);
    assert.match(runProcess(mcpBin, ['--help'], consumer.root), /exec-calls/);
    await runCompositionWitness(consumer.binDirectory);
    console.log('packed smoke: ok');
  } finally {
    consumer.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
