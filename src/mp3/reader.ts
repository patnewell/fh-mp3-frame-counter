import { setImmediate as nextTurn } from "node:timers/promises";
import { InvalidMp3Error } from "./error.ts";

// Limit byte progress between yields so a large input chunk cannot keep the
// event loop busy indefinitely without observing cancellation or other work.
export const PROGRESS_BYTES = 64 * 1024;

// read() assembles only small headers/footers. The largest supported descriptor
// is APE's 32-byte header/footer; frame and metadata payloads use skip() instead.
const MAX_DESCRIPTOR_BYTES = 32;

// Empty chunks make no byte progress. Yield during long sequences of them so
// they cannot bypass the normal progress-based cancellation/yield checkpoints.
const EMPTY_PULLS_PER_YIELD = 1024;
const EMPTY = Buffer.alloc(0);

/**
 * A forward-only cursor for one consumer reading an asynchronous byte stream.
 * Use its methods sequentially: they share one position and one current chunk.
 * Input is pulled on demand, and consumed chunks are released rather than saved.
 *
 * view() exposes bytes without consuming them; advance() consumes those bytes.
 * read() and skip() perform both steps. Returned buffers can borrow source memory,
 * so copy any bytes that must survive another reader operation. close() releases
 * the owned iterator when parsing finishes or fails.
 */
export class StreamReader {
  readonly #iterator: AsyncIterator<Uint8Array>;
  readonly #signal: AbortSignal | undefined;
  #chunk: Buffer = EMPTY;
  #chunkOffset = 0;
  #streamPosition = 0;
  #bytesSinceYield = 0;
  #done = false;
  #closed = false;

  constructor(input: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
    this.#iterator = input[Symbol.asyncIterator]();
    this.#signal = signal;
  }

  /** Bytes consumed from the source's start; fetching a chunk does not move this position. */
  get position(): number {
    return this.#streamPosition;
  }

  /**
   * Peek at the next bounded block without consuming it. An empty buffer means
   * EOF; empty producer chunks are ignored. The view borrows the current source
   * chunk and must be copied if retained across another reader operation.
   */
  async view(): Promise<Buffer> {
    this.#signal?.throwIfAborted();
    if (this.#bytesSinceYield >= PROGRESS_BYTES) await this.checkpoint();
    let emptyPulls = 0;
    while (this.#chunkOffset === this.#chunk.length && !this.#done) {
      this.#chunk = EMPTY;
      this.#chunkOffset = 0;
      this.#signal?.throwIfAborted();
      const next = await this.#iterator.next();
      this.#signal?.throwIfAborted();
      if (next.done) {
        this.#done = true;
      } else {
        this.#chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
        if (this.#chunk.length === 0 && ++emptyPulls % EMPTY_PULLS_PER_YIELD === 0) {
          await this.checkpoint();
        }
      }
    }
    return this.#chunk.subarray(
      this.#chunkOffset,
      Math.min(this.#chunk.length, this.#chunkOffset + PROGRESS_BYTES - this.#bytesSinceYield),
    );
  }

  /**
   * Consume bytes exposed by the most recent view. The caller must stay within
   * that view. This synchronous step lets payloads be consumed in blocks without
   * creating a promise for each byte.
   */
  advance(bytes: number): void {
    this.#chunkOffset += bytes;
    this.#streamPosition += bytes;
    this.#bytesSinceYield += bytes;
    if (this.#chunkOffset === this.#chunk.length) {
      this.#chunk = EMPTY;
      this.#chunkOffset = 0;
    }
  }

  /**
   * Read and consume length bytes (0–32), joining split headers/footers as needed.
   * EOF may return fewer bytes than requested; callers validate descriptor length.
   * A contiguous result borrows source memory, while a split result owns a copy.
   * Copy a result kept across reader operations rather than depending on which
   * path was taken. A zero-length read returns without pulling input.
   */
  async read(length: number): Promise<Buffer> {
    if (!Number.isInteger(length) || length < 0 || length > MAX_DESCRIPTOR_BYTES) {
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
      // descriptor now owns the carried bytes. Release the borrowed view before
      // pulling again so a small fragment cannot retain a large producer buffer.
      view = EMPTY;
      view = await this.view();
    }
    return descriptor.subarray(0, copied);
  }

  /**
   * Consume exactly length bytes without retaining their contents. Unlike read(),
   * this throws InvalidMp3Error if the source ends before the full extent arrives.
   */
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

  /**
   * Let other event-loop tasks run, check cancellation, then reset byte progress.
   * Buffered metadata searches also call this because their work can continue
   * after source EOF, without consuming new bytes to trigger view() checkpoints.
   */
  async checkpoint(): Promise<void> {
    this.#signal?.throwIfAborted();
    await nextTurn();
    this.#signal?.throwIfAborted();
    this.#bytesSinceYield = 0;
  }

  /**
   * Release the current chunk and await the iterator's return(), if provided.
   * Repeated calls do not return the iterator again; return failures propagate.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#chunk = EMPTY;
    await this.#iterator.return?.();
  }
}
