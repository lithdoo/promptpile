'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');

const isTypeScriptSource = name => /\.(?:[cm]?ts|tsx)$/i.test(name);

const listTypeScriptSources = directory => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptSources(entryPath));
    } else if (entry.isFile() && isTypeScriptSource(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
};

const walkFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-architecture-walk-'));
try {
  const nested = path.join(walkFixture, 'config', 'runtime');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'probe.ts'), 'export {};\n');
  fs.writeFileSync(path.join(nested, 'ignored.js'), 'module.exports = {};\n');
  assert.deepStrictEqual(
    listTypeScriptSources(walkFixture).map(file => path.relative(walkFixture, file)),
    [path.join('config', 'runtime', 'probe.ts')],
    'architecture source discovery must recurse into future src subdirectories'
  );
} finally {
  fs.rmSync(walkFixture, { recursive: true, force: true });
}

const productionFiles = listTypeScriptSources(src);

const privateBoundaryReferences = [];
for (const file of productionFiles) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('promptpile/dist/')) {
    privateBoundaryReferences.push(path.relative(root, file));
  }
}

assert.deepStrictEqual(
  privateBoundaryReferences,
  [],
  `production React source must not reference Promptpile private build modules: ${privateBoundaryReferences.join(', ')}`
);

for (const removedFile of [
  'promptpile-file-handler.d.ts',
  'promptpile-imports.d.ts',
  'resolve-llm-profile.ts'
]) {
  assert.strictEqual(
    fs.existsSync(path.join(src, removedFile)),
    false,
    `${removedFile} must not be restored`
  );
}

const reactTomlSource = fs.readFileSync(path.join(src, 'toml-config-react.ts'), 'utf8');
for (const forbiddenResolverFragment of [
  'doc.llm_api',
  'llmApis',
  'loadTomlConfigFile',
  'LlmApiProfile'
]) {
  assert.ok(
    !reactTomlSource.includes(forbiddenResolverFragment),
    `React must not resolve [[llm_api]] profiles locally: ${forbiddenResolverFragment}`
  );
}

const invokerSource = fs.readFileSync(path.join(src, 'promptpile-invoker.ts'), 'utf8');
assert.ok(
  invokerSource.includes('resolveDeclaredPackageBin'),
  'Promptpile executable discovery must follow package bin metadata'
);
assert.ok(
  !invokerSource.includes("'dist', 'index.js'"),
  'Promptpile executable discovery must not hardcode the build layout'
);

console.log('promptpile-react architecture boundary tests ok');
