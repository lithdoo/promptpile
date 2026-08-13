import path from 'node:path';
import { runCompositionWitness } from './composition-witness';
import { createFreshConsumer } from './fresh-consumer';

const repositoryRoot = path.resolve(__dirname, '../../../..');
const consumer = createFreshConsumer(repositoryRoot);
runCompositionWitness(consumer.binDirectory)
  .then(() => console.log('fresh public-bin Promptpile -> MCP -> Promptpile composition smoke: ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(consumer.cleanup);
