import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { countFrames } from "../../src/mp3/count.ts";
import {
  audioBytes,
  BOUNDARY,
  barrier,
  multipart,
  within,
  withUploadApp,
} from "../helpers/upload-lifecycle.ts";

const eventually = { timeout: 2000, interval: 10 };

describe("upload resource ownership over real HTTP", () => {
  it("admits four by default, rejects a fifth promptly, and keeps replicas and streams independent", async () => {
    const releaseCount = barrier();
    const inputs: AsyncIterable<Uint8Array>[] = [];
    const signals: AbortSignal[] = [];
    await withUploadApp(
      {},
      {
        count: async (input, signal) => {
          inputs.push(input);
          signals.push(signal);
          await releaseCount.promise;
          return countFrames(input, signal);
        },
      },
      async (first) => {
        const body = multipart(await audioBytes(), "../../private-client-name.mp3");
        try {
          const uploads = Array.from({ length: 4 }, () => first.open());
          for (const upload of uploads) upload.request.end(body);
          await vi.waitFor(() => expect(inputs).toHaveLength(4), eventually);
          expect(first.admission.active).toBe(4);
          expect(signals.every((signal) => !signal.aborted)).toBe(true);
          expect(new Set(inputs).size).toBe(4);
          const busy = first.open();
          busy.request.flushHeaders();
          expect(await within(busy.response)).toMatchObject({
            status: 503,
            headers: { "retry-after": "1" },
          });
          await within(busy.closed);
          expect(first.admission.active).toBe(4);
          await withUploadApp({ maxUploads: 1 }, {}, async (second) => {
            const accepted = second.open();
            accepted.request.end(body);
            expect(await within(accepted.response)).toMatchObject({
              status: 200,
              body: '{"frameCount":21}',
            });
            expect(first.admission.active).toBe(4);
          });
          releaseCount.release();
          for (const upload of uploads)
            expect(await within(upload.response)).toMatchObject({
              status: 200,
              body: '{"frameCount":21}',
            });
          expect(first.admission.active).toBe(0);
        } finally {
          releaseCount.release();
        }
      },
    );
  });

  it("retains capacity through expired uncooperative parsing until its promise settles", async () => {
    const counting = barrier();
    const releaseCount = barrier();
    let countSignal: AbortSignal | undefined;
    await withUploadApp(
      { maxUploads: 1, timeoutMs: 300 },
      {
        count: async (input, signal) => {
          countSignal = signal;
          const count = await countFrames(input);
          counting.release();
          await releaseCount.promise; // Deliberately ignores cancellation after consuming the source.
          return count;
        },
      },
      async (service) => {
        try {
          const body = multipart(await audioBytes());
          const upload = service.open();
          upload.request.end(body);
          await within(counting.promise);
          expect((await within(upload.response)).status).toBe(503);
          expect(countSignal?.aborted).toBe(true);
          expect(service.admission.active).toBe(1);
          const busy = service.open();
          busy.request.flushHeaders();
          expect((await within(busy.response)).status).toBe(503);
          releaseCount.release();
          await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
          const recovered = service.open();
          recovered.request.end(body);
          expect((await within(recovered.response)).status).toBe(200);
        } finally {
          releaseCount.release();
        }
      },
    );
  });

  it("cancels a disconnected client without releasing unsettled parsing", async () => {
    const counting = barrier();
    const releaseCount = barrier();
    let signal: AbortSignal | undefined;
    await withUploadApp(
      { maxUploads: 1 },
      {
        count: async (input, currentSignal) => {
          signal = currentSignal;
          const count = await countFrames(input);
          counting.release();
          await releaseCount.promise;
          return count;
        },
      },
      async (service) => {
        try {
          const body = multipart(await audioBytes());
          const upload = service.open();
          upload.request.end(body);
          await within(counting.promise);
          expect(signal?.aborted).toBe(false);
          upload.request.destroy();
          await expect(upload.response).rejects.toThrow();
          await vi.waitFor(() => expect(signal?.aborted).toBe(true), eventually);
          expect(service.admission.active).toBe(1);
          const busy = service.open();
          busy.request.flushHeaders();
          expect((await within(busy.response)).status).toBe(503);
          releaseCount.release();
          await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
          const recovered = service.open();
          recovered.request.end(body);
          expect((await within(recovered.response)).status).toBe(200);
        } finally {
          releaseCount.release();
        }
      },
    );
  });

  it.each(["before-part", "part-headers", "file-body"] as const)(
    "expires an unfinished %s and settles its stream work",
    async (stage) => {
      const count = vi.fn(countFrames);
      await withUploadApp({ timeoutMs: 100 }, { count }, async (service) => {
        const body = multipart(await audioBytes());
        const upload = service.open();
        if (stage === "before-part") upload.request.flushHeaders();
        if (stage === "part-headers") upload.request.write(`--${BOUNDARY}\r\nContent-Disposition:`);
        if (stage === "file-body")
          upload.request.write(body.subarray(0, body.indexOf("\r\n\r\n") + 8));
        expect((await within(upload.response)).status).toBe(503);
        await within(upload.closed);
        await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
        expect(count).toHaveBeenCalledTimes(stage === "file-body" ? 1 : 0);
      });
    },
  );

  it("finishes provisional counting during an open HTTP epilogue but cannot return success", async () => {
    const parsed = barrier();
    await withUploadApp(
      { timeoutMs: 300 },
      {
        count: async (input, signal) => {
          const count = await countFrames(input, signal);
          parsed.release();
          return count;
        },
      },
      async (service) => {
        const upload = service.open();
        let responded = false;
        void upload.response.then(() => {
          responded = true;
        });
        upload.request.write(multipart(await audioBytes()));
        await within(parsed.promise);
        expect(responded).toBe(false);
        expect(service.admission.active).toBe(1);
        expect((await within(upload.response)).status).toBe(503);
        await within(upload.closed);
        await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
      },
    );
  });

  it("rejects a malformed metadata header before file or HTTP EOF", async () => {
    await withUploadApp({ timeoutMs: 5000 }, {}, async (service) => {
      const upload = service.open();
      upload.request.write(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="private.mp3"\r\n\r\n`,
      );
      // Unsupported ID3 version is decidable from this descriptor; the producer remains open.
      upload.request.write(Buffer.from("49443305000000000000", "hex"));
      const response = await within(upload.response);
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: "The file is not a complete supported MPEG-1 Layer III stream.",
      });
      expect(upload.request.writableEnded).toBe(false);
      await within(upload.closed);
      await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
      const recovered = service.open();
      recovered.request.end(multipart(await audioBytes()));
      expect((await within(recovered.response)).status).toBe(200);
    });
  });

  it("settles a partial source after the client disconnects during reception", async () => {
    const started = barrier();
    const settled = barrier();
    await withUploadApp(
      {},
      {
        count: async (input, signal) => {
          started.release();
          try {
            return await countFrames(input, signal);
          } finally {
            settled.release();
          }
        },
      },
      async (service) => {
        const body = multipart(await audioBytes());
        const upload = service.open();
        upload.request.write(body.subarray(0, body.indexOf("\r\n\r\n") + 8));
        await within(started.promise);
        upload.request.destroy();
        await expect(upload.response).rejects.toThrow();
        await within(settled.promise);
        await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
      },
    );
  });

  it("closes an oversized rejected body without waiting for HTTP EOF", async () => {
    const count = vi.fn(countFrames);
    await withUploadApp({ timeoutMs: 5000 }, { count }, async (service) => {
      const rejected = service.open({ "content-type": "application/octet-stream" });
      rejected.request.write(Buffer.alloc(128 * 1024));
      const response = await within(rejected.response).catch((error: unknown) => {
        expect(error).toMatchObject({ code: "ECONNRESET" });
      });
      if (response) {
        expect(response.status).toBe(415);
        expect(JSON.parse(response.body)).toEqual({
          error: "Use multipart/form-data with one file field named file.",
        });
      }
      await within(rejected.closed);
      expect(rejected.request.writableEnded).toBe(false);
      await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
      expect(count).not.toHaveBeenCalled();
      const recovered = service.open();
      recovered.request.end(multipart(await audioBytes()));
      expect(await within(recovered.response)).toMatchObject({
        status: 200,
        body: '{"frameCount":21}',
      });
      expect(count).toHaveBeenCalledTimes(1);
      expect(service.admission.active).toBe(0);
    });
  });

  it("closes a stalled rejected body without waiting for the sender", async () => {
    await withUploadApp({ timeoutMs: 100 }, {}, async (service) => {
      const rejected = service.open({ "content-type": "application/octet-stream" });
      rejected.request.write(Buffer.from([1]));
      expect((await within(rejected.response)).status).toBe(415);
      await within(rejected.closed);
      await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
    });
  });

  it("reports an unexpected parser failure safely and accepts the next valid upload", async () => {
    let calls = 0;
    await withUploadApp(
      {},
      {
        count: async (input, signal) => {
          if (++calls === 1) throw new Error("PRIVATE_PARSER_FAILURE /private/input");
          return countFrames(input, signal);
        },
      },
      async (service) => {
        const body = multipart(await audioBytes());
        const failed = service.open();
        failed.request.end(body);
        const response = await within(failed.response);
        expect(response).toMatchObject({
          status: 500,
          body: '{"error":"The upload could not be processed."}',
        });
        expect(response.body).not.toContain("PRIVATE");
        await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
        const recovered = service.open();
        recovered.request.end(body);
        expect((await within(recovered.response)).status).toBe(200);
      },
    );
  });

  it("rejects a counter that returns before consuming its source instead of hanging or succeeding", async () => {
    await withUploadApp({}, { count: async () => 21 }, async (service) => {
      const body = multipart(await audioBytes());
      const upload = service.open();
      upload.request.end(body);
      expect((await within(upload.response)).status).toBe(500);
      await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
    });
  });

  it("holds drain and app.close until timed-out parser work settles", async () => {
    const counting = barrier();
    const releaseCount = barrier();
    await withUploadApp(
      { timeoutMs: 300 },
      {
        count: async (input) => {
          const count = await countFrames(input);
          counting.release();
          await releaseCount.promise;
          return count;
        },
      },
      async (service) => {
        try {
          const upload = service.open();
          upload.request.end(multipart(await audioBytes()));
          await within(counting.promise);
          expect((await within(upload.response)).status).toBe(503);
          service.admission.stop();
          const refused = service.open();
          refused.request.flushHeaders();
          expect(await within(refused.response)).toMatchObject({
            status: 503,
            headers: { "retry-after": "1" },
          });
          let drained = false;
          let closed = false;
          const drain = service.admission.drained().then(() => {
            drained = true;
          });
          const close = service.app.close().then(() => {
            closed = true;
          });
          await nextTurn();
          expect(service.admission.active).toBe(1);
          expect(drained).toBe(false);
          expect(closed).toBe(false);
          releaseCount.release();
          await within(Promise.all([drain, close]));
          expect(service.admission.active).toBe(0);
        } finally {
          releaseCount.release();
        }
      },
    );
  });
});
