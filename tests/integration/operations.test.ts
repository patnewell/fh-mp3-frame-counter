import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { countFrames } from "../../src/mp3/count.ts";
import { withHttpApp } from "../helpers/http.ts";
import {
  audioBytes,
  barrier,
  multipart,
  within,
  withUploadApp,
} from "../helpers/upload-lifecycle.ts";

describe("operational probes over real HTTP", () => {
  it("starts only after storage is usable and leaves no probe files behind", async () => {
    await withHttpApp({}, async ({ url, directory }) => {
      expect(await readdir(directory)).toEqual([]);
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
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it.each(["missing", "file"] as const)(
    "refuses startup when the configured temporary parent is %s",
    async (kind) => {
      const directory = await mkdtemp(join(tmpdir(), "mp3-startup-"));
      const tempDirectory = join(directory, "unusable");
      if (kind === "file") await writeFile(tempDirectory, "not a directory");
      const { app } = createApp({ tempDirectory });
      try {
        await expect(app.listen({ host: "127.0.0.1", port: 0 })).rejects.toThrow();
        expect(app.server.listening).toBe(false);
      } finally {
        await app.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("keeps liveness independent of failed storage and rechecks readiness after recovery", async () => {
    await withHttpApp({}, async ({ url, directory }) => {
      await rm(directory, { recursive: true });
      const unavailable = await fetch(`${url}/health/ready`);
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ status: "not-ready" });
      const live = await fetch(`${url}/health/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ status: "ok" });

      await mkdir(directory);
      const recovered = await fetch(`${url}/health/ready`);
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toEqual({ status: "ready" });
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it("remains ready at upload capacity and becomes not-ready when admission stops", async () => {
    const counting = barrier();
    const releaseCount = barrier();
    await withUploadApp(
      { maxUploads: 1 },
      {
        count: async (path, signal) => {
          counting.release();
          await releaseCount.promise;
          return countFrames(path, signal);
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
          releaseCount.release();
          expect((await within(upload.response)).status).toBe(200);
          expect(await readdir(service.directory)).toEqual([]);
        } finally {
          releaseCount.release();
        }
      },
    );
  });
});
