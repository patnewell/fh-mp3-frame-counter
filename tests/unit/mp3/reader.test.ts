import { describe, expect, it } from "vitest";
import { READ_WINDOW_BYTES } from "../../../src/mp3/reader.ts";
import { withReader } from "../../helpers/mp3.ts";

describe("bounded file window", () => {
  it("reads forward, across a window boundary and backward without changing old views", async () => {
    const bytes = Buffer.alloc(READ_WINDOW_BYTES * 2 + 7);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
    await withReader(bytes, async (input) => {
      const earlier = await input.read(13, 4);
      expect(await input.read(READ_WINDOW_BYTES - 1, 8)).toEqual(
        bytes.subarray(READ_WINDOW_BYTES - 1, READ_WINDOW_BYTES + 7),
      );
      expect(await input.read(3, 5)).toEqual(bytes.subarray(3, 8));
      expect(earlier).toEqual(bytes.subarray(13, 17));
      expect(await input.read(bytes.length - 2, 9)).toEqual(bytes.subarray(-2));
      expect(await input.read(bytes.length, 1)).toEqual(Buffer.alloc(0));
      expect(await input.read(0, 0)).toEqual(Buffer.alloc(0));
    });
  });

  it.each([
    [-1, 4],
    [0.5, 4],
    [Number.NaN, 4],
    [0, -1],
    [0, 0.5],
    [0, READ_WINDOW_BYTES + 1],
  ])("rejects invalid offset/length %s/%s", async (offset, length) => {
    await withReader(Buffer.alloc(20), async (input) => {
      await expect(input.read(offset, length)).rejects.toThrow(RangeError);
    });
  });

  it("checks abort even when the requested bytes are already cached", async () => {
    const controller = new AbortController();
    const reason = new Error("Stopped");
    await withReader(
      Buffer.alloc(20),
      async (input) => {
        await input.read(0, 4);
        controller.abort(reason);
        await expect(input.read(0, 4)).rejects.toBe(reason);
      },
      controller.signal,
    );
  });
});
