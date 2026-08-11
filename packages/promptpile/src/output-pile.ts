import fs from 'fs';
import path from 'path';
import type { ResolvedOutputPileTarget } from './output-artifact-policy';

export type OutputPileFormat = 'text' | 'json';

export interface OutputPileWriter {
  ready(): Promise<void>;
  writeDelta(chunk: string): void;
  writeDone(): void;
  writeError(error: unknown): void;
  close(): Promise<void>;
}

const noopWriter: OutputPileWriter = {
  ready: async () => undefined,
  writeDelta: () => undefined,
  writeDone: () => undefined,
  writeError: () => undefined,
  close: async () => undefined
};

export const parseOutputPileFormat = (value: unknown): OutputPileFormat | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('output pile format must be text or json');
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (trimmed === 'text' || trimmed === 'json') {
    return trimmed;
  }
  throw new Error('output pile format must be text or json');
};

export const parseOutputPileFd = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('output pile fd must be an integer >= 3');
  }
  const text = String(value).trim();
  if (text === '') {
    return undefined;
  }
  const fd = Number(text);
  if (!Number.isInteger(fd) || fd < 3) {
    throw new Error('output pile fd must be an integer >= 3');
  }
  return fd;
};

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const createStreamWriter = (
  stream: fs.WriteStream,
  format: OutputPileFormat,
  readyPromise: Promise<void>
): OutputPileWriter => {
  let closed = false;
  let streamError: Error | undefined;
  stream.on('error', err => {
    streamError = err;
  });

  const writeRaw = (content: string): void => {
    if (streamError) {
      throw streamError;
    }
    if (!closed) {
      stream.write(content, 'utf8');
    }
  };

  const writeJsonLine = (payload: Record<string, unknown>): void => {
    writeRaw(JSON.stringify(payload) + '\n');
  };

  return {
    ready: () => readyPromise,
    writeDelta: (chunk: string): void => {
      if (format === 'json') {
        writeJsonLine({ type: 'assistant_delta', content: chunk });
      } else {
        writeRaw(chunk);
      }
    },
    writeDone: (): void => {
      if (format === 'json') {
        writeJsonLine({ type: 'assistant_done' });
      }
    },
    writeError: (error: unknown): void => {
      if (format === 'json') {
        writeJsonLine({ type: 'error', message: messageFromError(error) });
      }
    },
    close: async (): Promise<void> => {
      if (closed) {
        return;
      }
      closed = true;
      if (streamError) {
        stream.destroy();
        throw streamError;
      }
      await new Promise<void>((resolve, reject) => {
        const onClose = (): void => {
          stream.off('error', onError);
          if (streamError) reject(streamError);
          else resolve();
        };
        const onError = (error: Error): void => {
          stream.off('close', onClose);
          reject(error);
        };
        stream.once('close', onClose);
        stream.once('error', onError);
        stream.end();
      });
    }
  };
};

export const createOutputPileWriter = (options: {
  target?: ResolvedOutputPileTarget;
  /** @deprecated Compatibility input; must already be absolute. */
  pileFile?: string;
  /** @deprecated Compatibility input. */
  pileFd?: number;
  format?: OutputPileFormat;
  dependencies?: {
    createFileStream?: (absolutePath: string) => fs.WriteStream;
    createFdStream?: (fd: number) => fs.WriteStream;
  };
}): OutputPileWriter => {
  const format = options.format ?? 'text';

  const target = options.target ?? (
    options.pileFd !== undefined
      ? { kind: 'fd' as const, fd: options.pileFd }
      : options.pileFile
        ? (() => {
            if (!path.isAbsolute(options.pileFile!)) {
              throw new Error('output pile writer requires an already-resolved absolute file path');
            }
            return {
              kind: 'file' as const,
              file: { absolutePath: path.normalize(options.pileFile!), identity: '' }
            };
          })()
        : undefined
  );

  if (target?.kind === 'fd') {
    if (!options.dependencies?.createFdStream) {
      fs.fstatSync(target.fd);
    }
    const stream = options.dependencies?.createFdStream?.(target.fd) ??
      fs.createWriteStream('', { fd: target.fd, encoding: 'utf8' });
    return createStreamWriter(stream, format, Promise.resolve());
  }

  if (target?.kind !== 'file') {
    return noopWriter;
  }

  const stream = options.dependencies?.createFileStream?.(target.file.absolutePath) ??
    fs.createWriteStream(target.file.absolutePath, { flags: 'w', encoding: 'utf8' });
  const readyPromise = new Promise<void>((resolve, reject) => {
    stream.once('open', () => resolve());
    stream.once('error', reject);
  });
  return createStreamWriter(stream, format, readyPromise);
};
