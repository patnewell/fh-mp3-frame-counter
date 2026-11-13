import { setImmediate as nextTurn } from "node:timers/promises";
import { expect, it } from "vitest";
import { countFrames } from "../../src/mp3/count.ts";
import { within } from "../helpers/async.ts";
import { audioBytes, multipart } from "../helpers/http.ts";
import { withUploadApp } from "../helpers/upload-lifecycle.ts";

it("awaits a disconnected parser's owned work before completing application close", async () => {
  const parsing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let cancelled: AbortSignal | undefined;
  await withUploadApp(
    {},
    {
      count: async (input, signal) => {
        cancelled = signal;
        const count = await countFrames(input);
        parsing.resolve();
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
        await expect.poll(() => cancelled?.aborted, { timeout: 2000 }).toBe(true);
        let closed = false;
        const closing = service.app.close().then(() => {
          closed = true;
        });
        await nextTurn();
        expect(service.admission.active).toBe(1);
        expect(closed).toBe(false);
        release.resolve();
        await within(closing);
        expect(service.admission.active).toBe(0);
      } finally {
        release.resolve();
      }
    },
  );
});
