import fs from 'fs';
import path from 'path';

export type OutputPileFormat = 'text' | 'json';

export interface OutputPileWriter {
  writeDelta(chunk: string): void;
  writeDone(): void;
  writeError(error: unknown): void;
  close(): Promise<void>;
}

const noopWriter: OutputPileWriter = {
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

const resolvePileFile = (pileFile: string): string =>
  path.isAbsolute(pileFile) ? pileFile : path.resolve(process.cwd(), pileFile);

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const createStreamWriter = (
  stream: fs.WriteStream,
  format: OutputPileFormat
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
      await new Promise<void>((resolve, reject) => {
        stream.end(() => {
          if (streamError) {
            reject(streamError);
          } else {
            resolve();
          }
        });
      });
    }
  };
};

export const createOutputPileWriter = (options: {
  pileFile?: string;
  pileFd?: number;
  format?: OutputPileFormat;
}): OutputPileWriter => {
  const format = options.format ?? 'text';

  if (options.pileFd !== undefined) {
    return createStreamWriter(
      fs.createWriteStream('', { fd: options.pileFd, encoding: 'utf8' }),
      format
    );
  }

  const rawFile = options.pileFile?.trim();
  if (!rawFile) {
    return noopWriter;
  }

  const resolvedFile = resolvePileFile(rawFile);
  fs.mkdirSync(path.dirname(resolvedFile), { recursive: true });
  return createStreamWriter(
    fs.createWriteStream(resolvedFile, { flags: 'w', encoding: 'utf8' }),
    format
  );
};
