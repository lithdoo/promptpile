'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  canonicalizeProspectivePath,
  isSameOrAncestor,
  pathsOverlap
} = require(path.join(root, 'dist', 'react-path-identity.js'));
const {
  cleanupReactSessionWork,
  createReactSessionWork
} = require(path.join(root, 'dist', 'react-session-work.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-session-work-'));
const authority = path.join(tmp, 'authority');
const workRoot = path.join(tmp, 'work-root');
fs.mkdirSync(authority);

const config = {
  configuredWorkRootAbs: workRoot,
  authoritativeReadLayersAbs: [authority]
};

try {
  assert.ok(isSameOrAncestor(tmp, path.join(tmp, 'child')));
  assert.ok(!isSameOrAncestor(path.join(tmp, 'child'), tmp));
  assert.ok(pathsOverlap(tmp, path.join(tmp, 'child')));
  assert.strictEqual(
    canonicalizeProspectivePath(path.join(tmp, 'missing', '..', 'future')),
    path.join(tmp, 'future')
  );

  const first = createReactSessionWork(config);
  const second = createReactSessionWork(config);
  assert.notStrictEqual(first.workDirectoryAbs, second.workDirectoryAbs);
  assert.ok(fs.existsSync(path.join(first.workDirectoryAbs, '.promptpile-react-session.json')));
  cleanupReactSessionWork({ session: first, succeeded: true, debug: false });
  assert.ok(!fs.existsSync(first.workDirectoryAbs));
  assert.ok(fs.existsSync(workRoot), 'configured work root is never removed');

  const ordinaryFailure = createReactSessionWork(config);
  cleanupReactSessionWork({ session: ordinaryFailure, succeeded: false, debug: false });
  assert.ok(!fs.existsSync(ordinaryFailure.workDirectoryAbs), 'ordinary failure cleans its session');

  cleanupReactSessionWork({ session: second, succeeded: false, debug: true });
  assert.ok(fs.existsSync(second.workDirectoryAbs), 'debug failure preserves the exact session');
  fs.rmSync(second.workDirectoryAbs, { recursive: true, force: true });

  const tampered = createReactSessionWork(config);
  fs.writeFileSync(
    path.join(tampered.workDirectoryAbs, '.promptpile-react-session.json'),
    JSON.stringify({ version: 1, session_id: 'other', created_by: 'promptpile-react' })
  );
  const previousError = console.error;
  const warnings = [];
  console.error = value => warnings.push(String(value));
  try {
    cleanupReactSessionWork({ session: tampered, succeeded: true, debug: false });
  } finally {
    console.error = previousError;
  }
  assert.ok(fs.existsSync(tampered.workDirectoryAbs), 'mismatched marker refuses deletion');
  assert.ok(warnings.some(line => line.includes('ownership marker')));
  fs.rmSync(tampered.workDirectoryAbs, { recursive: true, force: true });

  const sharedRoot = path.join(tmp, 'shared-root');
  const authorityBelowRoot = path.join(sharedRoot, 'reserved-authority');
  fs.mkdirSync(authorityBelowRoot, { recursive: true });
  const besideAuthority = createReactSessionWork({
    configuredWorkRootAbs: sharedRoot,
    authoritativeReadLayersAbs: [authorityBelowRoot]
  });
  assert.ok(!pathsOverlap(besideAuthority.workDirectoryAbs, authorityBelowRoot));
  cleanupReactSessionWork({ session: besideAuthority, succeeded: true, debug: false });

  const sessionsBeforeMarkerFailure = fs.existsSync(workRoot)
    ? fs.readdirSync(workRoot).filter(name => name.startsWith('promptpile-react-session-')).sort()
    : [];
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = (target, ...args) => {
    if (path.basename(String(target)) === '.promptpile-react-session.json') {
      throw new Error('injected marker write failure');
    }
    return originalWriteFileSync(target, ...args);
  };
  try {
    assert.throws(() => createReactSessionWork(config), /injected marker write failure/);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.deepStrictEqual(
    fs.readdirSync(workRoot).filter(name => name.startsWith('promptpile-react-session-')).sort(),
    sessionsBeforeMarkerFailure,
    'marker failure rolls back only the freshly created session directory'
  );

  const realAuthority = path.join(tmp, 'real-authority');
  const authorityAlias = path.join(tmp, 'authority-alias');
  fs.mkdirSync(realAuthority);
  try {
    fs.symlinkSync(realAuthority, authorityAlias, 'junction');
    assert.throws(
      () => createReactSessionWork({
        configuredWorkRootAbs: path.join(authorityAlias, 'nested-work'),
        authoritativeReadLayersAbs: [realAuthority]
      }),
      /inside authoritative layer/
    );
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  }

  assert.throws(
    () => createReactSessionWork({
      configuredWorkRootAbs: path.join(authority, 'nested-work'),
      authoritativeReadLayersAbs: [authority]
    }),
    /inside authoritative layer/
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('promptpile-react session work tests ok');
