import { execFile } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { get } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { withinProcess, withProcessSandbox } from "../helpers/process.ts";

// The POSIX FIFO is a deterministic filesystem barrier, not a portable Windows signal simulation.
it.skipIf(process.platform === "win32")(
  "awaits a disconnected readiness probe before completing application close (POSIX FIFO)",
  async () => {
    await withProcessSandbox(async (sandbox) => {
      const fifo = join(sandbox.cwd, "worker barrier");
      await promisify(execFile)("mkfifo", [fifo]);
      const service = await sandbox.server(
        { UV_THREADPOOL_SIZE: "1" },
        new URL("../helpers/readiness-server.ts", import.meta.url),
        [fifo],
      );
      await service.process.event("fixture_worker_queued");
      const readiness = get(`${service.url}/health/ready`, { agent: false });
      readiness.on("error", () => undefined); // Disconnect is the behavior under test.
      try {
        await service.process.event("fixture_probe_queued");
        const disconnected = once(readiness, "close");
        void disconnected.catch(() => undefined);
        readiness.destroy();
        await withinProcess(disconnected.catch(() => undefined));
        service.process.child.kill("SIGUSR2");
        const observed = await service.process.event("fixture_close_observed");
        const release = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
        await release.close();
        const completed = await service.process.event("fixture_close_complete");
        expect(await withinProcess(service.process.exited)).toMatchObject({
          code: 0,
          signal: null,
        });
        expect(observed.closedBeforeRelease).toBe(false);
        expect(completed.remainingEntries).toBe(0);
        expect(await readdir(sandbox.directory)).toEqual([]);
      } finally {
        readiness.destroy();
        // Nonblocking release cannot hang cleanup if the child has already failed or exited.
        const release = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK).catch(
          () => undefined,
        );
        await release?.close();
      }
    });
  },
);
