import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { discardRejectedBody } from "../../../src/upload/error.ts";

describe("bounded rejection disposal", () => {
  it("stops after the byte allowance plus at most the chunk that crosses it", async () => {
    const chunk = Buffer.alloc(16 * 1024);
    const input = Readable.from(
      Array.from({ length: 20 }, () => chunk),
      { objectMode: false },
    );
    let consumed = 0;
    input.on("data", (bytes: Buffer) => {
      consumed += bytes.length;
    });
    await discardRejectedBody(input, new AbortController().signal);
    expect(consumed).toBeGreaterThan(0);
    expect(consumed).toBeLessThanOrEqual(65_536 + chunk.length);
    expect(input.destroyed).toBe(true);
  });

  it("disposes a stalled rejected body when its request is cancelled", async () => {
    const input = new PassThrough();
    const controller = new AbortController();
    const discarded = discardRejectedBody(input, controller.signal);
    input.write("partial body");
    controller.abort();
    await discarded;
    expect(input.destroyed).toBe(true);
    expect(input.listenerCount("data")).toBe(0);
  });

  it("handles cancellation that preceded discard without starting an unbounded read", async () => {
    const input = new PassThrough();
    const controller = new AbortController();
    controller.abort();
    await discardRejectedBody(input, controller.signal);
    expect(input.destroyed).toBe(true);
  });

  it("accepts a completed or already closed body", async () => {
    const signal = new AbortController().signal;
    const input = Readable.from([Buffer.from("small rejected body")]);
    await discardRejectedBody(input, signal);
    expect(input.readableEnded).toBe(true);
    await discardRejectedBody(input, signal);
    const closed = new PassThrough();
    closed.destroy();
    await discardRejectedBody(closed, signal);
  });

  it("does not replace the original rejection with a discarded stream failure", async () => {
    const input = new Readable({
      read() {
        this.destroy(new Error("private transport details"));
      },
    });
    await expect(discardRejectedBody(input, new AbortController().signal)).resolves.toBeUndefined();
    expect(input.destroyed).toBe(true);
  });
});
