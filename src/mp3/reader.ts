import { setImmediate as nextTurn } from "node:timers/promises";
import { InvalidMp3Error } from "./error.ts";

export const PROGRESS_BYTES = 64 * 1024;
const EMPTY = Buffer.alloc(0);

/** Own one iterator and borrow at most its current chunk; retained descriptors own their bytes. */
export class StreamReader {
  readonly #iterator: AsyncIterator<Uint8Array>;
  readonly #signal: AbortSignal | undefined;
  #chunk: Buffer = EMPTY;
  #offset = 0;
  #position = 0;
  #progress = 0;
  #done = false;
  #closed = false;

  constructor(input: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
    this.#iterator = input[Symbol.asyncIterator]();
    this.#signal = signal;
  }

  get position(): number {
    return this.#position;
  }

  /** The returned view is borrowed until the next reader operation; callers copy saved fields. */
  async view(): Promise<Buffer> {
    this.#signal?.throwIfAborted();
    if (this.#progress >= PROGRESS_BYTES) await this.checkpoint();
    let emptyPulls = 0;
    while (this.#offset === this.#chunk.length && !this.#done) {
      this.#chunk = EMPTY;
      this.#offset = 0;
      this.#signal?.throwIfAborted();
      const next = await this.#iterator.next();
      this.#signal?.throwIfAborted();
      if (next.done) {
        this.#done = true;
      } else {
        this.#chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
        // An endless series of empty chunks must not starve a request deadline either.
        if (this.#chunk.length === 0 && ++emptyPulls % 1024 === 0) await this.checkpoint();
      }
    }
    return this.#chunk.subarray(
      this.#offset,
      Math.min(this.#chunk.length, this.#offset + PROGRESS_BYTES - this.#progress),
    );
  }

  /** Consume only bytes from the last bounded view; payload skipping needs no per-byte promises. */
  advance(bytes: number): void {
    this.#offset += bytes;
    this.#position += bytes;
    this.#progress += bytes;
    if (this.#offset === this.#chunk.length) {
      this.#chunk = EMPTY;
      this.#offset = 0;
    }
  }

  /** Small descriptors can borrow a contiguous view; only a split descriptor needs a copy. */
  async read(length: number): Promise<Buffer> {
    if (!Number.isInteger(length) || length < 0 || length > 32) {
      throw new RangeError("A stream descriptor must fit 32 bytes.");
    }
    if (length === 0) return EMPTY;
    let view = await this.view();
    if (view.length >= length) {
      const result = view.subarray(0, length);
      this.advance(length);
      return result;
    }
    const descriptor = Buffer.alloc(length);
    let copied = 0;
    while (view.length > 0) {
      const bytes = Math.min(length - copied, view.length);
      view.copy(descriptor, copied, 0, bytes);
      this.advance(bytes);
      copied += bytes;
      if (copied === length) break;
      view = EMPTY; // A tiny carried fragment must not pin a consumed producer buffer during a pull.
      view = await this.view();
    }
    return descriptor.subarray(0, copied);
  }

  async skip(length: number, context = "MPEG frame"): Promise<void> {
    let remaining = length;
    while (remaining > 0) {
      const view = await this.view();
      if (view.length === 0) throw new InvalidMp3Error(`Incomplete ${context}.`);
      const bytes = Math.min(remaining, view.length);
      this.advance(bytes);
      remaining -= bytes;
    }
  }

  /** Also used by bounded metadata searches whose CPU work can revisit buffered bytes. */
  async checkpoint(): Promise<void> {
    this.#signal?.throwIfAborted();
    await nextTurn();
    this.#signal?.throwIfAborted();
    this.#progress = 0;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#chunk = EMPTY;
    await this.#iterator.return?.();
  }
}
