import { StringDecoder } from 'string_decoder';

const MAX_LINE_BYTES = 1024 * 1024;

export class FinalStreamInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinalStreamInvalidError';
  }
}

export class FinalOutputPileDecoder {
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';
  private done = false;
  private failed = false;

  constructor(private readonly onDelta: (content: string) => Promise<void>) {}

  async push(chunk: Buffer): Promise<void> {
    this.assertUsable();
    this.buffer += this.decoder.write(chunk);
    await this.consumeLines(false);
    this.assertLineLimit();
  }

  async finish(): Promise<void> {
    this.assertUsable();
    this.buffer += this.decoder.end();
    await this.consumeLines(true);
    if (!this.done) this.fail('final stream ended without assistant_done');
  }

  private async consumeLines(eof: boolean): Promise<void> {
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      await this.consumeLine(line);
    }
    if (eof && this.buffer !== '') {
      const line = this.buffer.replace(/\r$/, '');
      this.buffer = '';
      await this.consumeLine(line);
    }
  }

  private async consumeLine(line: string): Promise<void> {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) this.fail('final stream line exceeds 1 MiB');
    if (line === '') this.fail('final stream contains an empty line');
    let value: unknown;
    try { value = JSON.parse(line); } catch { this.fail('final stream contains malformed JSON'); }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.fail('final stream event must be an object');
    }
    const event = value as Record<string, unknown>;
    if (this.done) this.fail('final stream contains an event after assistant_done');
    if (event.type === 'assistant_delta') {
      if (typeof event.content !== 'string') this.fail('assistant_delta content must be a string');
      if (event.content !== '') await this.onDelta(event.content);
      return;
    }
    if (event.type === 'assistant_done') {
      this.done = true;
      return;
    }
    if (event.type === 'error') this.fail('final stream reported an error');
    this.fail('final stream contains an unknown event type');
  }

  private assertLineLimit(): void {
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_LINE_BYTES) {
      this.fail('final stream line exceeds 1 MiB');
    }
  }

  private assertUsable(): void {
    if (this.failed) throw new FinalStreamInvalidError('final stream is already invalid');
  }

  private fail(message: string): never {
    this.failed = true;
    throw new FinalStreamInvalidError(message);
  }
}
