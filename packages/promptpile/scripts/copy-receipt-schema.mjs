import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(
  packageRoot,
  '..',
  '..',
  'doc',
  '15-contracts',
  'completion-receipt-v1.schema.json'
);
const destination = path.join(packageRoot, 'dist', 'completion-receipt-v1.schema.json');
const protocolCopy = path.join(packageRoot, '..', 'promptpile-protocol', 'dist', 'schemas', 'completion-receipt-v1.json');

fs.copyFileSync(fs.existsSync(protocolCopy) ? protocolCopy : source, destination);
