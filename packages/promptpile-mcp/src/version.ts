import fs from 'fs';
import path from 'path';

const candidates = [
  path.resolve(__dirname, '../../package.json'),
  path.resolve(__dirname, '../package.json'),
];
const packagePath = candidates.find((candidate) => fs.existsSync(candidate));
if (!packagePath) throw new Error('promptpile-mcp: package.json not found');
const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown };
if (typeof metadata.version !== 'string' || metadata.version === '') {
  throw new Error('promptpile-mcp: package version is invalid');
}
export const PACKAGE_VERSION = metadata.version;
