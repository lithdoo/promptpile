import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.rmSync(path.join(packageRoot, 'dist'), { recursive: true, force: true });
