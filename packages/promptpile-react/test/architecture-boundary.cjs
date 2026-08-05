'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');

const productionFiles = fs.readdirSync(src, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
  .map(entry => path.join(src, entry.name));

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
