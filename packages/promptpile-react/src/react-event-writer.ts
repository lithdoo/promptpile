import { randomBytes } from 'crypto';
import type { Writable } from 'stream';
import {
  isTerminalEventType,
  type ReactEventPayloadV1,
  type ReactEventV1
} from './react-event-protocol';

export class ReactEventOutputError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ReactEventOutputError';
  }
}

export class ReactEventWriterV1 {
  readonly sessionId: string;
  private sequence = 0;
  private terminal = false;
  private failed = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly output: Writable = process.stdout,
    sessionId = `react_${randomBytes(16).toString('hex')}`
  ) {
    if (sessionId.trim() === '') throw new Error('session id must not be empty');
    this.sessionId = sessionId;
    this.output.on('error', () => { this.failed = true; });
  }

  emit(payload: ReactEventPayloadV1): Promise<void> {
    const operation = this.chain.then(() => this.write(payload));
    this.chain = operation.catch(() => undefined);
    return operation;
  }

  isWritable(): boolean { return !this.failed && !this.output.destroyed; }
  hasTerminated(): boolean { return this.terminal; }

  private async write(payload: ReactEventPayloadV1): Promise<void> {
    if (this.failed) throw new ReactEventOutputError('protocol output is not writable');
    if (this.terminal) throw new ReactEventOutputError('cannot emit after terminal event');

    const event: ReactEventV1 = {
      ...payload,
      schema_version: 1,
      session_id: this.sessionId,
      sequence: this.sequence
    } as ReactEventV1;
    const line = `${JSON.stringify(event)}\n`;
    try {
      await new Promise<void>((resolve, reject) => {
        this.output.write(line, 'utf8', error => error ? reject(error) : resolve());
      });
    } catch (error) {
      this.failed = true;
      throw new ReactEventOutputError('failed to write protocol output', error);
    }
    this.sequence += 1;
    if (isTerminalEventType(payload.type)) this.terminal = true;
  }
}
