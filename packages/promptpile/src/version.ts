interface PackageMetadata {
  version?: unknown;
}

// At runtime dist/version.js is one directory below the packed package.json.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageMetadata = require('../package.json') as PackageMetadata;

if (typeof packageMetadata.version !== 'string' || packageMetadata.version.trim() === '') {
  throw new Error('promptpile package metadata does not contain a valid version');
}

export const PROMPTPILE_VERSION = packageMetadata.version;
