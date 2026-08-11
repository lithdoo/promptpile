import fs from 'fs';
import path from 'path';
import type { ResolveAfterHookResult } from './after-hook';
import { classifyConversationArtifactName } from './conversation-artifact-name';
import type { Config } from './types';

export interface ResolvedFileTarget {
  absolutePath: string;
  identity: string;
}

export type ResolvedOutputPileTarget =
  | { kind: 'file'; file: ResolvedFileTarget }
  | { kind: 'fd'; fd: number };

export interface ResolvedOutputArtifactPolicyV1 {
  terminal: { quiet: boolean };
  outputPile?: {
    target: ResolvedOutputPileTarget;
    format: 'text' | 'json';
    shadowedFile?: string;
  };
  mainOutput?: {
    body: ResolvedFileTarget;
    calls: ResolvedFileTarget;
    extra: ResolvedFileTarget;
  };
  conversation: {
    continueEnabled: boolean;
    mutationEnabled: boolean;
    outputDirectory?: string;
    outputDirectoryIndex?: number;
  };
  hook: ResolveAfterHookResult;
}

const comparisonIdentity = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value;

const absoluteLexicalPath = (cwd: string, raw: string): string =>
  path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd, raw);

const lexicalFileTarget = (cwd: string, raw: string): ResolvedFileTarget => {
  const absolutePath = absoluteLexicalPath(cwd, raw);
  return { absolutePath, identity: comparisonIdentity(absolutePath) };
};

const canonicalFileTarget = (target: ResolvedFileTarget): ResolvedFileTarget => {
  const parent = fs.realpathSync(path.dirname(target.absolutePath));
  const absolutePath = path.join(parent, path.basename(target.absolutePath));
  return { absolutePath: target.absolutePath, identity: comparisonIdentity(absolutePath) };
};

export const resolveMainOutputTargets = (
  cwd: string,
  rawBodyPath: string
): ResolvedOutputArtifactPolicyV1['mainOutput'] => {
  const body = lexicalFileTarget(cwd, rawBodyPath);
  const { dir, name } = path.parse(body.absolutePath);
  return {
    body,
    calls: lexicalFileTarget(cwd, path.join(dir, `${name}.calls.jsonl`)),
    extra: lexicalFileTarget(cwd, path.join(dir, `${name}.extra.json`))
  };
};

const allFileTargets = (policy: ResolvedOutputArtifactPolicyV1): Array<{
  label: string;
  target: ResolvedFileTarget;
}> => {
  const targets: Array<{ label: string; target: ResolvedFileTarget }> = [];
  if (policy.mainOutput) {
    targets.push(
      { label: 'main body', target: policy.mainOutput.body },
      { label: 'main calls', target: policy.mainOutput.calls },
      { label: 'main extra', target: policy.mainOutput.extra }
    );
  }
  if (policy.outputPile?.target.kind === 'file') {
    targets.push({ label: 'output pile', target: policy.outputPile.target.file });
  }
  return targets;
};

const validateDistinctTargets = (
  targets: Array<{ label: string; target: ResolvedFileTarget }>
): void => {
  const seen = new Map<string, string>();
  for (const { label, target } of targets) {
    const previous = seen.get(target.identity);
    if (previous !== undefined) {
      throw new Error(`output artifact target collision: ${previous} and ${label}: ${target.absolutePath}`);
    }
    seen.set(target.identity, label);
  }
};

const validateConversationNamespace = (
  policy: ResolvedOutputArtifactPolicyV1,
  targets: Array<{ label: string; target: ResolvedFileTarget }>
): void => {
  const outputDirectory = policy.conversation.outputDirectory;
  if (!outputDirectory) return;
  const outputIdentity = comparisonIdentity(
    fs.existsSync(outputDirectory) ? fs.realpathSync(outputDirectory) : path.normalize(outputDirectory)
  );
  for (const { label, target } of targets) {
    const targetParentIdentity = path.dirname(target.identity);
    if (targetParentIdentity !== outputIdentity) continue;
    const basename = path.basename(target.absolutePath);
    if (comparisonIdentity(basename) === comparisonIdentity('.promptpile.occ.claim')) {
      throw new Error(`output artifact target uses reserved Conversation control path (${label}): ${target.absolutePath}`);
    }
    if (policy.conversation.mutationEnabled && classifyConversationArtifactName(basename)) {
      throw new Error(`output artifact target collides with Conversation namespace (${label}): ${target.absolutePath}`);
    }
  }
};

const validateHookCollision = (
  policy: ResolvedOutputArtifactPolicyV1,
  targets: Array<{ label: string; target: ResolvedFileTarget }>
): void => {
  if (policy.hook.status !== 'run') return;
  const hookIdentity = comparisonIdentity(policy.hook.path);
  const collision = targets.find(({ target }) => target.identity === hookIdentity);
  if (collision) {
    throw new Error(`output artifact target would overwrite resolved after-hook (${collision.label}): ${collision.target.absolutePath}`);
  }
};

export const resolveOutputArtifactPolicy = (options: {
  cwd: string;
  config: Config;
  hook: ResolveAfterHookResult;
}): ResolvedOutputArtifactPolicyV1 => {
  const { cwd, config, hook } = options;
  const outputPileTarget: ResolvedOutputPileTarget | undefined =
    config.outputPileTarget?.kind === 'file'
      ? { kind: 'file', file: lexicalFileTarget(cwd, config.outputPileTarget.path) }
      : config.outputPileTarget?.kind === 'fd'
        ? { kind: 'fd', fd: config.outputPileTarget.fd }
        : undefined;
  const outputDirectory = config.conversationIo.outputDirectory;
  const policy: ResolvedOutputArtifactPolicyV1 = {
    terminal: { quiet: config.quiet },
    outputPile: outputPileTarget === undefined ? undefined : {
      target: outputPileTarget,
      format: config.outputPileFormat ?? 'text',
      shadowedFile: config.outputPileTarget?.shadowedFile
    },
    mainOutput: config.output ? resolveMainOutputTargets(cwd, config.output) : undefined,
    conversation: {
      continueEnabled: config.continueMode,
      mutationEnabled: config.continueMode || config.inputMode,
      outputDirectory,
      outputDirectoryIndex: outputDirectory === undefined
        ? undefined
        : config.conversationIo.inputDirectories.indexOf(outputDirectory)
    },
    hook
  };
  const targets = allFileTargets(policy);
  validateDistinctTargets(targets);
  validateConversationNamespace(policy, targets);
  validateHookCollision(policy, targets);
  return policy;
};

/** Prepare parents, then repeat collision validation using canonical parent identities. */
export const prepareOutputArtifactPolicy = (
  policy: ResolvedOutputArtifactPolicyV1
): ResolvedOutputArtifactPolicyV1 => {
  const lexicalTargets = allFileTargets(policy);
  for (const { target } of lexicalTargets) {
    const parent = path.dirname(target.absolutePath);
    fs.mkdirSync(parent, { recursive: true });
    fs.accessSync(parent, fs.constants.W_OK);
  }
  const canonicalByPath = new Map(
    lexicalTargets.map(({ target }) => [target.absolutePath, canonicalFileTarget(target)])
  );
  const canonicalize = (target: ResolvedFileTarget): ResolvedFileTarget =>
    canonicalByPath.get(target.absolutePath) ?? target;
  const prepared: ResolvedOutputArtifactPolicyV1 = {
    ...policy,
    mainOutput: policy.mainOutput && {
      body: canonicalize(policy.mainOutput.body),
      calls: canonicalize(policy.mainOutput.calls),
      extra: canonicalize(policy.mainOutput.extra)
    },
    outputPile: policy.outputPile && {
      ...policy.outputPile,
      target: policy.outputPile.target.kind === 'file'
        ? { kind: 'file', file: canonicalize(policy.outputPile.target.file) }
        : policy.outputPile.target
    }
  };
  const targets = allFileTargets(prepared);
  validateDistinctTargets(targets);
  validateConversationNamespace(prepared, targets);
  validateHookCollision(prepared, targets);
  return prepared;
};
