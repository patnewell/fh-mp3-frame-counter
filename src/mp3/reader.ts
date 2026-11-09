import type { FileHandle } from "node:fs/promises";

export const READ_WINDOW_BYTES = 64 * 1024;

/** A single bounded window over a completed file. Its caller owns the descriptor. */
export class FileReader {
  readonly size: number;
  readonly #file: FileHandle;
  readonly #signal: AbortSignal | undefined;
  #start = 0;
  #window = Buffer.alloc(0);

  constructor(file: FileHandle, size: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(size) || size < 0) throw new RangeError("Invalid file size.");
    this.#file = file;
    this.size = size;
    this.#signal = signal;
  }

  /** Returned views remain valid after a later refill, but must be treated as read-only. */
  async read(offset: number, length: number): Promise<Buffer> {
    this.#signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("Invalid read offset.");
    if (!Number.isSafeInteger(length) || length < 0 || length > READ_WINDOW_BYTES) {
      throw new RangeError("Read length must fit the bounded window.");
    }
    const available = Math.min(length, Math.max(0, this.size - offset));
    if (available === 0) return Buffer.alloc(0);

    if (offset < this.#start || offset + available > this.#start + this.#window.length) {
      const aligned = Math.floor(offset / READ_WINDOW_BYTES) * READ_WINDOW_BYTES;
      this.#start = offset + available <= aligned + READ_WINDOW_BYTES ? aligned : offset;
      const window = Buffer.allocUnsafe(Math.min(READ_WINDOW_BYTES, this.size - this.#start));
      let filled = 0;
      while (filled < window.length) {
        const { bytesRead } = await this.#file.read(
          window,
          filled,
          window.length - filled,
          this.#start + filled,
        );
        this.#signal?.throwIfAborted();
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      this.#window = window.subarray(0, filled);
    }
    const start = offset - this.#start;
    return this.#window.subarray(start, start + available);
  }
}
