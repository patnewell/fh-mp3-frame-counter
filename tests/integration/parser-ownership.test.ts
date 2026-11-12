import { setImmediate as nextTurn } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { countFrames } from "../../src/mp3/count.ts";
import {
  audioBytes,
  barrier,
  multipart,
  within,
  withUploadApp,
} from "../helpers/upload-lifecycle.ts";

it("awaits a disconnected parser's owned work before completing application close", async () => {
  const parsing = barrier();
  const release = barrier();
  let cancelled: AbortSignal | undefined;
  await withUploadApp(
    {},
    {
      count: async (input, signal) => {
        cancelled = signal;
        const count = await countFrames(input);
        parsing.release();
        await release.promise;
        return count;
      },
    },
    async (service) => {
      const upload = service.open();
      try {
        upload.request.end(multipart(await audioBytes()));
        await within(parsing.promise);
        upload.request.destroy();
        await expect(upload.response).rejects.toThrow();
        await vi.waitFor(() => expect(cancelled?.aborted).toBe(true), { timeout: 2000 });
        let closed = false;
        const closing = service.app.close().then(() => {
          closed = true;
        });
        await nextTurn();
        expect(service.admission.active).toBe(1);
        expect(closed).toBe(false);
        release.release();
        await within(closing);
        expect(service.admission.active).toBe(0);
      } finally {
        release.release();
      }
    },
  );
});
