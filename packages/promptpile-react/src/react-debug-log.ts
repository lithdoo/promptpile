import fs from 'fs';

/**
 * Opt-in orchestration diagnostics (stderr, `[promptpile-react]` prefix).
 * Set `PROMPTPILE_REACT_DEBUG=1` (or `true` / `yes` / `on`) — does not enable child `promptpile` `PROMPTPILE_DEBUG`.
 */

const DEBUG_TEXT_MAX = 16_384;

const truncateForDebug = (s: string, max: number = DEBUG_TEXT_MAX): string => {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]`;
};

const envTruthy = (name: string): boolean => {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

export const isPromptpileReactDebug = (): boolean => envTruthy('PROMPTPILE_REACT_DEBUG');

export type ReactDumpPhase = 'thought' | 'observe' | 'check' | 'final';

export const buildPromptpileChildEnv = (phase: ReactDumpPhase): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  if (isPromptpileReactDebug()) {
    env.PROMPTPILE_DUMP_LLM = '1';
    env.PROMPTPILE_DUMP_LLM_TAG = phase;
  }
  return env;
};

/** One line per call when debug is on; always stderr so stdout stays for streamed model text. */
export const reactDebugLog = (...parts: unknown[]): void => {
  if (!isPromptpileReactDebug()) {
    return;
  }
  console.error('[promptpile-react]', ...parts);
};

/** Observe 子进程结束后：从 `-o` 主文件读取纯文本回复（仅 debug）。 */
export const logObservePhaseLlmOutput = (outPath: string): void => {
  if (!isPromptpileReactDebug()) {
    return;
  }

  let reply: string;
  try {
    if (!fs.existsSync(outPath)) {
      reply = '(output file missing)';
    } else {
      const raw = fs.readFileSync(outPath, 'utf8').trim();
      reply = raw === '' ? '(empty)' : raw;
    }
  } catch (e) {
    reply = `(read error: ${e instanceof Error ? e.message : String(e)})`;
  }
  reactDebugLog('phase=observe llm_reply:\n', truncateForDebug(reply));
};

/** Check 子进程结束后：从 `-o` 主文件与 `{basename}.calls.jsonl` 读取（仅 debug）。 */
export const logCheckPhaseLlmOutput = (outPath: string, callsPath: string): void => {
  if (!isPromptpileReactDebug()) {
    return;
  }

  let reply: string;
  try {
    if (!fs.existsSync(outPath)) {
      reply = '(output file missing)';
    } else {
      const raw = fs.readFileSync(outPath, 'utf8').trim();
      reply = raw === '' ? '(empty)' : raw;
    }
  } catch (e) {
    reply = `(read error: ${e instanceof Error ? e.message : String(e)})`;
  }
  reactDebugLog('phase=check llm_reply:\n', truncateForDebug(reply));

  let calls: string;
  try {
    if (!fs.existsSync(callsPath)) {
      calls = '(calls file missing)';
    } else {
      const raw = fs.readFileSync(callsPath, 'utf8').trim();
      if (raw === '') {
        calls = '(empty)';
      } else {
        const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
        calls = lines
          .map((line) => {
            try {
              return JSON.stringify(JSON.parse(line) as unknown, null, 2);
            } catch {
              return line;
            }
          })
          .join('\n---\n');
      }
    }
  } catch (e) {
    calls = `(read error: ${e instanceof Error ? e.message : String(e)})`;
  }
  reactDebugLog('phase=check tool_calls:\n', truncateForDebug(calls));
};
