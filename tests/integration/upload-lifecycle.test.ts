import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, sep } from "node:path";
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
  it("admits four by default, rejects a fifth promptly, and keeps replicas and private paths independent", async () => {
    const releaseCount = barrier();
    const paths: string[] = [];
    const signals: AbortSignal[] = [];
    await withUploadApp(
      {},
      {
        count: async (path, signal) => {
          paths.push(path);
          signals.push(signal);
          await releaseCount.promise;
          return countFrames(path, signal);
        },
      },
      async (first) => {
        const body = multipart(await audioBytes(), "../../private-client-name.mp3");
        try {
          const uploads = Array.from({ length: 4 }, () => first.open());
          for (const upload of uploads) upload.request.end(body);
          await vi.waitFor(() => expect(paths).toHaveLength(4), eventually);
          expect(first.admission.active).toBe(4);
          expect(signals.every((signal) => !signal.aborted)).toBe(true);
          expect(new Set(paths.map(dirname)).size).toBe(4);
          for (const path of paths) {
            expect(basename(path)).toBe("upload.mp3");
            expect(dirname(path).startsWith(`${first.directory}${sep}`)).toBe(true);
            if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
          }

          const busy = first.open();
          busy.request.flushHeaders();
          expect(await within(busy.response)).toMatchObject({
            status: 503,
            headers: { "retry-after": "1" },
          });
          await within(busy.closed);
          expect(first.admission.active).toBe(4);
          expect(await readdir(first.directory)).toHaveLength(4);

          await withUploadApp({ maxUploads: 1 }, {}, async (second) => {
            expect(second.directory).not.toBe(first.directory);
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
          expect(await readdir(first.directory)).toEqual([]);
        } finally {
          releaseCount.release();
        }
      },
    );
  });

  it("retains capacity through expired uncooperative counting and delayed disposal", async () => {
    const counting = barrier();
    const releaseCount = barrier();
    const disposing = barrier();
    const releaseDisposal = barrier();
    let countSignal: AbortSignal | undefined;
    await withUploadApp(
      { maxUploads: 1, timeoutMs: 500 },
      {
        count: async (path, signal) => {
          countSignal = signal;
          counting.release();
          await releaseCount.promise;
          return countFrames(path); // Deliberately ignores cancellation to model unsettled work.
        },
        dispose: async (directory) => {
          disposing.release();
          await releaseDisposal.promise;
          await rm(directory, { recursive: true, force: true });
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
          const busyDuringCount = service.open();
          busyDuringCount.request.flushHeaders();
          expect((await within(busyDuringCount.response)).status).toBe(503);

          releaseCount.release();
          await within(disposing.promise);
          expect(service.admission.active).toBe(1);
          expect(await readdir(service.directory)).toHaveLength(1);
          const busyDuringDisposal = service.open();
          busyDuringDisposal.request.flushHeaders();
          expect((await within(busyDuringDisposal.response)).status).toBe(503);
          releaseDisposal.release();
          await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
          expect(await readdir(service.directory)).toEqual([]);
          const recovered = service.open();
          recovered.request.end(body);
          expect(await within(recovered.response)).toMatchObject({
            status: 200,
            body: '{"frameCount":21}',
          });
        } finally {
          releaseCount.release();
          releaseDisposal.release();
        }
      },
    );
  });

  it("cancels a disconnected client without releasing unsettled counting", async () => {
    const counting = barrier();
    const releaseCount = barrier();
    let signal: AbortSignal | undefined;
    await withUploadApp(
      { maxUploads: 1 },
      {
        count: async (path, currentSignal) => {
          signal = currentSignal;
          counting.release();
          await releaseCount.promise;
          return countFrames(path);
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
          expect(await readdir(service.directory)).toEqual([]);
          const recovered = service.open();
          recovered.request.end(body);
          expect((await within(recovered.response)).status).toBe(200);
        } finally {
          releaseCount.release();
        }
      },
    );
  });

  it.each(["before-part", "part-headers", "file-body", "epilogue"] as const)(
    "expires an unfinished %s without invoking the parser",
    async (stage) => {
      let countCalls = 0;
      await withUploadApp(
        { timeoutMs: 100 },
        {
          count: async () => {
            countCalls++;
            return 21;
          },
        },
        async (service) => {
          const body = multipart(await audioBytes());
          const upload = service.open();
          if (stage === "before-part") upload.request.flushHeaders();
          if (stage === "part-headers")
            upload.request.write(`--${BOUNDARY}\r\nContent-Disposition:`);
          if (stage === "file-body")
            upload.request.write(body.subarray(0, body.indexOf("\r\n\r\n") + 8));
          if (stage === "epilogue") upload.request.write(body);
          expect((await within(upload.response)).status).toBe(503);
          await within(upload.closed);
          await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
          expect(countCalls).toBe(0);
          expect(await readdir(service.directory)).toEqual([]);
        },
      );
    },
  );

  it("disposes an incomplete file after the client disconnects during reception", async () => {
    await withUploadApp({}, {}, async (service) => {
      const body = multipart(await audioBytes());
      const upload = service.open();
      upload.request.write(body.subarray(0, body.indexOf("\r\n\r\n") + 8));
      await vi.waitFor(
        async () => expect(await readdir(service.directory)).toHaveLength(1),
        eventually,
      );
      upload.request.destroy();
      await expect(upload.response).rejects.toThrow();
      await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
      expect(await readdir(service.directory)).toEqual([]);
    });
  });

  it("closes an oversized rejected body without waiting for HTTP EOF", async () => {
    await withUploadApp({ timeoutMs: 5000 }, {}, async (service) => {
      const rejected = service.open({ "content-type": "application/octet-stream" });
      rejected.request.write(Buffer.alloc(128 * 1024));
      expect((await within(rejected.response)).status).toBe(415);
      await within(rejected.closed);
      expect(service.admission.active).toBe(0);
      expect(await readdir(service.directory)).toEqual([]);
    });
  });

  it("closes a stalled rejected body without waiting for the sender", async () => {
    await withUploadApp({ timeoutMs: 100 }, {}, async (service) => {
      const rejected = service.open({ "content-type": "application/octet-stream" });
      rejected.request.write(Buffer.from([1]));
      expect((await within(rejected.response)).status).toBe(415);
      await within(rejected.closed);
      await vi.waitFor(() => expect(service.admission.active).toBe(0), eventually);
      expect(await readdir(service.directory)).toEqual([]);
    });
  });

  it("releases failed storage creation and recovers after the parent is restored", async () => {
    await withUploadApp({}, {}, async (service) => {
      const body = multipart(await audioBytes());
      await rm(service.directory, { recursive: true });
      const failed = service.open();
      failed.request.end(body);
      const response = await within(failed.response);
      expect(response.status).toBe(500);
      expect(response.body).not.toContain(JSON.stringify(service.directory).slice(1, -1));
      expect(service.admission.active).toBe(0);
      await mkdir(service.directory);
      const recovered = service.open();
      recovered.request.end(body);
      expect((await within(recovered.response)).status).toBe(200);
      expect(await readdir(service.directory)).toEqual([]);
    });
  });

  it("reports failed disposal honestly, releases the attempt, and permits later uploads", async () => {
    let removals = 0;
    await withUploadApp(
      {},
      {
        dispose: async (directory) => {
          if (++removals === 1) throw new Error(`Private deletion failure: ${directory}`);
          await rm(directory, { recursive: true, force: true });
        },
      },
      async (service) => {
        const body = multipart(await audioBytes());
        const failed = service.open();
        failed.request.end(body);
        const response = await within(failed.response);
        expect(response.status).toBe(500);
        expect(response.body).not.toContain("Private deletion failure");
        expect(response.body).not.toContain(JSON.stringify(service.directory).slice(1, -1));
        expect(service.admission.active).toBe(0);
        const orphans = await readdir(service.directory);
        expect(orphans).toHaveLength(1);
        const recovered = service.open();
        recovered.request.end(body);
        expect((await within(recovered.response)).status).toBe(200);
        expect(await readdir(service.directory)).toEqual(orphans);
      },
    );
  });

  it("stops new admission and holds both drain and app.close until timed-out disposal settles", async () => {
    const disposing = barrier();
    const releaseDisposal = barrier();
    await withUploadApp(
      { timeoutMs: 500 },
      {
        dispose: async (directory) => {
          disposing.release();
          await releaseDisposal.promise;
          await rm(directory, { recursive: true, force: true });
        },
      },
      async (service) => {
        try {
          const upload = service.open();
          upload.request.end(multipart(await audioBytes()));
          await within(disposing.promise);
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
          releaseDisposal.release();
          await within(Promise.all([drain, close]));
          expect(service.admission.active).toBe(0);
          expect(await readdir(service.directory)).toEqual([]);
        } finally {
          releaseDisposal.release();
        }
      },
    );
  });
});
