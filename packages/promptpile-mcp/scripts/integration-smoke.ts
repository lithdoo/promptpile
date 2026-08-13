import path from 'node:path';
import { runCompositionWitness } from './composition-witness';

const repositoryRoot = path.resolve(__dirname, '../../../..');
runCompositionWitness(path.join(repositoryRoot, 'node_modules', '.bin'))
  .then(() => console.log('public-bin Promptpile -> MCP -> Promptpile composition smoke: ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
