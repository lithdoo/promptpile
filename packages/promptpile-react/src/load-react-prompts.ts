import fs from 'fs';
import path from 'path';
import { DEFAULT_REACT_CHECK, DEFAULT_REACT_CORE, DEFAULT_REACT_OBSERVE } from './default-react-prompts';

export const REACT_PROMPT_FILES = {
  core: '.react.core.md',
  final: '.react.final.md',
  observe: '.react.observe.md',
  check: '.react.check.md'
} as const;

export interface ReactPromptTexts {
  core: string;
  final: string;
  observe: string;
  check: string;
}

const readUtf8IfExists = (absPath: string): string | undefined => {
  try {
    if (!fs.existsSync(absPath)) {
      return undefined;
    }
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return undefined;
  }
};

export interface ReactPromptPathConfig {
  thought?: string;
  observe?: string;
  check?: string;
  final?: string;
}

const resolvePromptPath = (directoryAbs: string, configured: string | undefined, fallbackFile: string): string | undefined => {
  if (configured !== undefined) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(directoryAbs, configured);
  }
  const fallback = path.join(directoryAbs, fallbackFile);
  return fs.existsSync(fallback) ? fallback : undefined;
};

/**
 * 从扫描目录读取提示词：配置路径优先，否则 `.react.*.md`，core/observe/check 再回退内置默认。
 */
export function loadReactPromptsFromConfig(
  directoryAbs: string,
  paths?: ReactPromptPathConfig
): ReactPromptTexts {
  const corePath = resolvePromptPath(directoryAbs, paths?.thought, REACT_PROMPT_FILES.core);
  const observePath = resolvePromptPath(directoryAbs, paths?.observe, REACT_PROMPT_FILES.observe);
  const checkPath = resolvePromptPath(directoryAbs, paths?.check, REACT_PROMPT_FILES.check);
  const finalPath = resolvePromptPath(directoryAbs, paths?.final, REACT_PROMPT_FILES.final);

  const rawCore = corePath !== undefined ? readUtf8IfExists(corePath) : undefined;
  const rawObserve = observePath !== undefined ? readUtf8IfExists(observePath) : undefined;
  const rawCheck = checkPath !== undefined ? readUtf8IfExists(checkPath) : undefined;
  const rawFinal = finalPath !== undefined ? readUtf8IfExists(finalPath) : undefined;

  const pickCore =
    rawCore !== undefined && rawCore.trim() !== '' ? rawCore.trim() : DEFAULT_REACT_CORE;
  const pickObserve =
    rawObserve !== undefined && rawObserve.trim() !== ''
      ? rawObserve.trim()
      : DEFAULT_REACT_OBSERVE;
  const pickCheck =
    rawCheck !== undefined && rawCheck.trim() !== '' ? rawCheck.trim() : DEFAULT_REACT_CHECK;
  const pickFinal =
    rawFinal !== undefined && rawFinal.trim() !== '' ? rawFinal.trim() : '';

  return {
    core: pickCore,
    final: pickFinal,
    observe: pickObserve,
    check: pickCheck
  };
}

/** @deprecated Use {@link loadReactPromptsFromConfig} with resolved directory. */
export function loadReactPrompts(directory: string | undefined): ReactPromptTexts {
  if (directory === undefined || directory.trim() === '') {
    return {
      core: DEFAULT_REACT_CORE,
      final: '',
      observe: DEFAULT_REACT_OBSERVE,
      check: DEFAULT_REACT_CHECK
    };
  }
  return loadReactPromptsFromConfig(path.resolve(process.cwd(), directory.trim()));
}
