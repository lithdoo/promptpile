import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(packageRoot, 'dist');

if (path.dirname(dist) !== packageRoot || path.basename(dist) !== 'dist') {
  throw new Error(`Refusing to clean unexpected path: ${dist}`);
}

fs.rmSync(dist, { recursive: true, force: true });
