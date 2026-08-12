'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const workspaceRoots = ['packages', 'agent-lite-tools'];
for (const workspaceRoot of workspaceRoots) {
  const root = path.join(repositoryRoot, workspaceRoot);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(
      manifest.scripts?.prepare,
      undefined,
      `${path.relative(repositoryRoot, manifestPath)} must not build during workspace install; use explicit build and prepack`
    );
  }
}

const workflowRoot = path.join(repositoryRoot, '.github', 'workflows');
for (const name of fs.readdirSync(workflowRoot)) {
  if (!name.endsWith('.yml')) continue;
  const source = fs.readFileSync(path.join(workflowRoot, name), 'utf8');
  const protocolBuild = source.search(/npm run build -w promptpile-protocol/);
  const promptpileBuild = source.search(/npm run build -w promptpile(?:\s|$)/m);
  if (promptpileBuild >= 0) {
    assert(protocolBuild >= 0, `${name} must build protocol before promptpile`);
    assert(protocolBuild < promptpileBuild, `${name} must preserve protocol -> promptpile build order`);
  }
  if (/npm run test -w promptpile-compress(?:\s|$)/m.test(source)) {
    assert(protocolBuild >= 0, `${name} must build protocol before promptpile-compress`);
  }
}
