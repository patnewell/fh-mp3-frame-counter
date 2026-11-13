import { describe, expect, it } from "vitest";
import { countFrames } from "../../src/mp3/count.ts";
import { within } from "../helpers/async.ts";
import { audioBytes, multipart, withHttpApp } from "../helpers/http.ts";
import { withUploadApp } from "../helpers/upload-lifecycle.ts";

describe("operational probes over real HTTP", () => {
  it("serves exact liveness and concurrent readiness probes without a storage dependency", async () => {
    await withHttpApp({}, async ({ url }) => {
      const live = await fetch(`${url}/health/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ status: "ok" });
      const checks = await Promise.all(
        Array.from({ length: 6 }, () => fetch(`${url}/health/ready`)),
      );
      for (const ready of checks) {
        expect(ready.status).toBe(200);
        expect(await ready.json()).toEqual({ status: "ready" });
      }
    });
  });

  it("remains ready at upload capacity and becomes not-ready when admission stops", async () => {
    const counting = Promise.withResolvers<void>();
    const releaseCount = Promise.withResolvers<void>();
    await withUploadApp(
      { maxUploads: 1 },
      {
        count: async (input, signal) => {
          counting.resolve();
          await releaseCount.promise;
          return countFrames(input, signal);
        },
      },
      async (service) => {
        const url = service.app.listeningOrigin;
        const upload = service.open();
        try {
          upload.request.end(multipart(await audioBytes()));
          await within(counting.promise);
          expect(service.admission.active).toBe(1);
          const ready = await fetch(`${url}/health/ready`);
          expect(ready.status).toBe(200);
          expect(await ready.json()).toEqual({ status: "ready" });
          expect(service.admission.active).toBe(1);
          service.admission.stop();
          const draining = await fetch(`${url}/health/ready`);
          expect(draining.status).toBe(503);
          expect(await draining.json()).toEqual({ status: "not-ready" });
          const live = await fetch(`${url}/health/live`);
          expect(live.status).toBe(200);
          expect(await live.json()).toEqual({ status: "ok" });
          releaseCount.resolve();
          expect((await within(upload.response)).status).toBe(200);
        } finally {
          releaseCount.resolve();
        }
      },
    );
  });
});
