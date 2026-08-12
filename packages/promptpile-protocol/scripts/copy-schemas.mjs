import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..');
const source = path.join(repositoryRoot, 'doc', '15-contracts', 'completion-receipt-v1.schema.json');
const destination = path.join(packageRoot, 'dist', 'schemas', 'completion-receipt-v1.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
