import { describe, expect, it } from "vitest";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { PROGRESS_BYTES, StreamReader } from "../../../src/mp3/reader.ts";
import { chunkBytes } from "../../helpers/mp3.ts";

describe("bounded stream cursor", () => {
  it("assembles small descriptors across producer boundaries and tracks forward position", async () => {
    const input = new StreamReader(chunkBytes(Uint8Array.of(1, 2, 3, 4, 5, 6), [1, 2]));
    try {
      expect(await input.read(4)).toEqual(Buffer.from([1, 2, 3, 4]));
      expect(input.position).toBe(4);
      await input.skip(1);
      expect(await input.read(4)).toEqual(Buffer.from([6]));
      expect(input.position).toBe(6);
      expect(await input.read(1)).toEqual(Buffer.alloc(0));
    } finally {
      await input.close();
    }
  });

  it("copies split fragments so retained descriptors do not pin large producer buffers", async () => {
    const backing = Buffer.alloc(1024 * 1024, 9);
    backing[backing.length - 2] = 1;
    backing[backing.length - 1] = 2;
    async function* source() {
      yield backing.subarray(-2);
      backing.fill(7);
      yield Uint8Array.of(3, 4);
      yield Uint8Array.of(5);
    }
    const input = new StreamReader(source());
    try {
      const descriptor = await input.read(4);
      expect(descriptor).toEqual(Buffer.from([1, 2, 3, 4]));
      expect(descriptor.buffer).not.toBe(backing.buffer);
      expect(descriptor.buffer.byteLength).toBeLessThanOrEqual(32);
      await input.read(1);
      expect(descriptor).toEqual(Buffer.from([1, 2, 3, 4]));
    } finally {
      await input.close();
    }
  });

  it("pulls only on demand and returns its iterator exactly once when closed", async () => {
    let pulls = 0;
    let returns = 0;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            pulls++;
            return { done: false, value: Uint8Array.of(1, 2, 3, 4) };
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            returns++;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const input = new StreamReader(source);
    expect(pulls).toBe(0);
    try {
      expect(await input.read(1)).toEqual(Buffer.from([1]));
      expect(pulls).toBe(1);
      await input.skip(3);
      expect(pulls).toBe(1);
      expect(await input.read(1)).toEqual(Buffer.from([1]));
      expect(pulls).toBe(2);
    } finally {
      await input.close();
      await input.close();
    }
    expect(returns).toBe(1);
  });

  it.each([-1, 0.5, Number.NaN, 33])("rejects invalid descriptor length %s", async (length) => {
    const input = new StreamReader(chunkBytes(Uint8Array.of(1)));
    try {
      await expect(input.read(length)).rejects.toThrow(RangeError);
    } finally {
      await input.close();
    }
  });

  it("allows a zero-length descriptor without pulling input", async () => {
    let pulls = 0;
    async function* source() {
      pulls++;
      yield Uint8Array.of(1);
    }
    const input = new StreamReader(source());
    try {
      expect(await input.read(0)).toEqual(Buffer.alloc(0));
      expect(pulls).toBe(0);
    } finally {
      await input.close();
    }
  });

  it("rejects EOF during a skipped payload", async () => {
    const input = new StreamReader(chunkBytes(Uint8Array.of(1, 2)));
    try {
      await expect(input.skip(3)).rejects.toThrow(InvalidMp3Error);
    } finally {
      await input.close();
    }
  });

  it("checks cancellation even while bytes remain in the current producer chunk", async () => {
    const controller = new AbortController();
    const reason = new Error("Stopped");
    const input = new StreamReader(chunkBytes(Uint8Array.of(1, 2, 3, 4)), controller.signal);
    try {
      await input.read(1);
      controller.abort(reason);
      await expect(input.read(1)).rejects.toBe(reason);
    } finally {
      await input.close();
    }
  });

  it("bounds each borrowed processing view even for a very large producer chunk", async () => {
    const input = new StreamReader(
      chunkBytes(Buffer.alloc(3 * PROGRESS_BYTES), [3 * PROGRESS_BYTES]),
    );
    try {
      const first = await input.view();
      expect(first.length).toBe(PROGRESS_BYTES);
      input.advance(first.length);
      const second = await input.view();
      expect(second.length).toBe(PROGRESS_BYTES);
      expect(input.position).toBe(PROGRESS_BYTES);
    } finally {
      await input.close();
    }
  });
});
