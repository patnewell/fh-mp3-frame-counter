import { describe, expect, it } from "vitest";
import { countFrames } from "../../../src/mp3/count.ts";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { within } from "../../helpers/async.ts";
import { chunkBytes, frame } from "../../helpers/mp3.ts";

describe("incremental parser acceptance", () => {
  it("counts complete frames from an asynchronous byte source", async () => {
    async function* source() {
      yield frame();
      yield frame();
    }
    expect(await countFrames(source())).toBe(2);
  });

  it("validates a complete invalid descriptor before requesting more input or EOF", async () => {
    const release = Promise.withResolvers<void>();
    let requestedEOF = false;
    let closed = false;
    async function* source() {
      try {
        yield Buffer.from("49443305000000000000", "hex"); // Unsupported ID3 major version.
        requestedEOF = true;
        await release.promise;
      } finally {
        closed = true;
      }
    }
    const pending = countFrames(source());
    void pending.catch(() => undefined);
    try {
      await expect(within(pending)).rejects.toBeInstanceOf(InvalidMp3Error);
      expect(requestedEOF).toBe(false);
      expect(closed).toBe(true);
    } finally {
      release.resolve();
      await pending.catch(() => undefined);
    }
  });

  it.each(["one large chunk", "one-byte chunks"])(
    "lets event-loop cancellation interrupt %s without a source I/O wait",
    async (chunking) => {
      const bytes = Buffer.concat(Array.from({ length: 512 }, () => frame()));
      const controller = new AbortController();
      const reason = new Error("Event-loop cancellation");
      const cancellation = setImmediate(() => controller.abort(reason));
      try {
        await expect(
          countFrames(
            chunkBytes(bytes, [chunking === "one-byte chunks" ? 1 : bytes.length]),
            controller.signal,
          ),
        ).rejects.toBe(reason);
      } finally {
        clearImmediate(cancellation);
      }
    },
  );
});
