import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { id3 } from "../helpers/mp3.ts";
import {
  compiledHealthcheck,
  compiledServer,
  openProcessUpload,
  withinProcess,
  withProcessSandbox,
} from "../helpers/process.ts";
import { audioBytes, BOUNDARY, multipart } from "../helpers/upload-lifecycle.ts";

const uploadHeaders = { "content-type": `multipart/form-data; boundary=${BOUNDARY}` };
const disposalServer = new URL("../helpers/disposal-server.ts", import.meta.url);
const eventually = { timeout: 3000, interval: 20 };

describe("compiled application from an unrelated directory with spaces", () => {
  it("counts the unchanged assignment sample, serves exact probes and disposes uploaded data", async () => {
    await withProcessSandbox(async (sandbox) => {
      expect(sandbox.cwd).toContain(" ");
      const service = await sandbox.server();
      const live = await fetch(`${service.url}/health/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ status: "ok" });
      const ready = await fetch(`${service.url}/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: "ready" });
      const body = multipart(await readFile(new URL("../fixtures/sample.mp3", import.meta.url)));
      const upload = openProcessUpload(`${service.url}/file-upload`, uploadHeaders);
      try {
        upload.request.end(body);
        const response = await withinProcess(upload.response);
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toMatch(/^application\/json/);
        expect(JSON.parse(response.body)).toEqual({ frameCount: 6090 });
        expect(await readdir(sandbox.directory)).toEqual([]);
      } finally {
        upload.request.destroy();
      }
    });
  });

  it.each([
    ["PORT", "private-invalid-port"],
    ["MAX_UPLOADS", "0"],
    ["REQUEST_TIMEOUT_MS", "2147483648"],
    ["UPLOAD_TEMP_DIR", "private-relative-directory"],
    ["LOG_LEVEL", "private-invalid-log-level"],
  ])(
    "rejects invalid %s at the real entrypoint without reflecting its value",
    async (name, value) => {
      await withProcessSandbox(async (sandbox) => {
        const process = sandbox.start(compiledServer, { [name]: value });
        const result = await withinProcess(process.exited);
        expect(result).toMatchObject({ code: 1, signal: null });
        expect(process.records().some((record) => record.event === "server_started")).toBe(false);
        if (value.startsWith("private-")) expect(process.output()).not.toContain(value);
        expect(await readdir(sandbox.directory)).toEqual([]);
      });
    },
  );

  it("refuses unavailable startup storage without leaking its private path", async () => {
    await withProcessSandbox(async (sandbox) => {
      const missing = join(sandbox.cwd, "private-missing-parent");
      const process = sandbox.start(compiledServer, {
        UPLOAD_TEMP_DIR: missing,
        LOG_LEVEL: "trace",
      });
      expect(await withinProcess(process.exited)).toMatchObject({ code: 1, signal: null });
      expect(process.output()).not.toContain("private-missing-parent");
      expect(process.output()).not.toContain(JSON.stringify(sandbox.cwd).slice(1, -1));
      expect(process.records().some((record) => record.event === "server_started")).toBe(false);
    });
  });

  it("keeps liveness independent and recovers readiness when storage is restored", async () => {
    await withProcessSandbox(async (sandbox) => {
      const service = await sandbox.server();
      const healthy = sandbox.start(compiledHealthcheck, {
        HOST: "0.0.0.0",
        PORT: String(service.port),
      });
      expect(await withinProcess(healthy.exited)).toMatchObject({
        code: 0,
        stdout: "",
        stderr: "",
      });
      await rm(sandbox.directory, { recursive: true });
      const ready = await fetch(`${service.url}/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: "not-ready" });
      const live = await fetch(`${service.url}/health/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ status: "ok" });
      const unhealthy = sandbox.start(compiledHealthcheck, { PORT: String(service.port) });
      expect(await withinProcess(unhealthy.exited)).toMatchObject({
        code: 1,
        stdout: "",
        stderr: "",
      });
      await mkdir(sandbox.directory);
      expect(await (await fetch(`${service.url}/health/ready`)).json()).toEqual({
        status: "ready",
      });
    });
  });

  it("keeps trace logs free of client content, identifiers, headers, raw URLs and private paths", async () => {
    await withProcessSandbox(async (sandbox) => {
      const service = await sandbox.server({ LOG_LEVEL: "trace" });
      const markers = [
        "PRIVATE_FILENAME",
        "PRIVATE_CLIENT_ID",
        "PRIVATE_HEADER",
        "PRIVATE_QUERY",
        "PRIVATE_BYTES",
        "PRIVATE_UNKNOWN_ROUTE",
      ];
      const body = multipart(
        Buffer.concat([id3(Buffer.from("PRIVATE_BYTES")), await audioBytes()]),
        "PRIVATE_FILENAME.mp3",
      );
      const upload = openProcessUpload(`${service.url}/file-upload?token=PRIVATE_QUERY`, {
        ...uploadHeaders,
        "x-request-id": "PRIVATE_CLIENT_ID",
        authorization: "Bearer PRIVATE_HEADER",
      });
      try {
        upload.request.end(body);
        const response = await withinProcess(upload.response);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ frameCount: 21 });
        const requestId = response.headers["x-request-id"];
        expect(requestId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        await (await fetch(`${service.url}/PRIVATE_UNKNOWN_ROUTE?secret=PRIVATE_QUERY`)).text();
        await vi.waitFor(
          () =>
            expect(
              service.process
                .records()
                .some(
                  (record) =>
                    record.event === "request_completed" && record.requestId === requestId,
                ),
            ).toBe(true),
          eventually,
        );
        for (const marker of markers) expect(service.process.output()).not.toContain(marker);
        expect(service.process.output()).not.toContain(JSON.stringify(sandbox.cwd).slice(1, -1));
        const completed = service.process
          .records()
          .find((record) => record.event === "request_completed" && record.requestId === requestId);
        expect(completed).toMatchObject({ route: "upload", statusCode: 200 });
        expect(completed).not.toHaveProperty("req");
        expect(completed).not.toHaveProperty("res");
        expect(completed).not.toHaveProperty("err");
      } finally {
        upload.request.destroy();
      }
    });
  });

  it.each(["content-length", "chunked"] as const)(
    "survives a malformed second multipart part over %s",
    async (framing) => {
      await withProcessSandbox(async (sandbox) => {
        const service = await sandbox.server({ LOG_LEVEL: "trace" });
        const valid = multipart(await audioBytes());
        const suffix = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
        const body = Buffer.concat([
          valid.subarray(0, valid.length - suffix.length),
          Buffer.from(
            `\r\n--${BOUNDARY}\r\nPRIVATE_MALFORMED_HEADER\r\n\r\nPRIVATE_MALFORMED_BODY\r\n--${BOUNDARY}--\r\n`,
          ),
        ]);
        const upload = openProcessUpload(`${service.url}/file-upload`, {
          ...uploadHeaders,
          ...(framing === "content-length"
            ? { "content-length": String(body.length) }
            : { "transfer-encoding": "chunked" }),
        });
        try {
          if (framing === "chunked") {
            upload.request.write(body.subarray(0, valid.length - suffix.length));
            upload.request.end(body.subarray(valid.length - suffix.length));
          } else upload.request.end(body);
          const response = await withinProcess(upload.response);
          expect(response.status).toBe(413);
          expect(JSON.parse(response.body)).toEqual({
            error: "The upload exceeds a file or multipart limit.",
          });
          expect(await (await fetch(`${service.url}/health/ready`)).json()).toEqual({
            status: "ready",
          });
          expect(service.process.output()).not.toContain("PRIVATE_MALFORMED");
          expect(await readdir(sandbox.directory)).toEqual([]);
        } finally {
          upload.request.destroy();
        }
      });
    },
  );

  it("observes a disposal failure after timeout without printing its exception or private path", async () => {
    await withProcessSandbox(async (sandbox) => {
      const service = await sandbox.server(
        { LOG_LEVEL: "trace", REQUEST_TIMEOUT_MS: "500" },
        disposalServer,
        ["late-failure"],
      );
      const upload = openProcessUpload(`${service.url}/file-upload`, uploadHeaders);
      try {
        upload.request.end(multipart(await audioBytes()));
        const response = await withinProcess(upload.response);
        expect(response.status).toBe(503);
        expect(JSON.parse(response.body)).toEqual({ error: "The upload deadline expired." });
        const failure = await service.process.event("upload_failed");
        expect(failure).toMatchObject({ category: "cleanup" });
        expect(service.process.output()).not.toContain("PRIVATE_DISPOSAL_FAILURE");
        expect(service.process.output()).not.toContain(
          JSON.stringify(sandbox.directory).slice(1, -1),
        );
        expect(await readdir(sandbox.directory)).toHaveLength(1); // The failed disposal really left data.
        expect(await (await fetch(`${service.url}/health/live`)).json()).toEqual({ status: "ok" });
      } finally {
        upload.request.destroy();
      }
    });
  });
});

describe("compiled silent healthcheck", () => {
  it.each(["0", "not-a-port", "65536"])("rejects invalid probe port %s silently", async (PORT) => {
    await withProcessSandbox(async (sandbox) => {
      expect(
        await withinProcess(sandbox.start(compiledHealthcheck, { PORT }).exited),
      ).toMatchObject({ code: 1, stdout: "", stderr: "" });
    });
  });

  it("treats a completed HTTP 200 as success without interpreting its body", async () => {
    await withProbeServer(
      (_request, reply) => reply.end("a completed non-JSON response"),
      async (port) => {
        await withProcessSandbox(async (sandbox) => {
          expect(
            await withinProcess(sandbox.start(compiledHealthcheck, { PORT: String(port) }).exited),
          ).toMatchObject({ code: 0, stdout: "", stderr: "" });
        });
      },
    );
  });

  it("fails silently when the destination refuses the connection", async () => {
    let closedPort = 0;
    await withProbeServer(
      (_request, reply) => reply.end(),
      async (port) => {
        closedPort = port;
      },
    );
    await withProcessSandbox(async (sandbox) => {
      expect(
        await withinProcess(
          sandbox.start(compiledHealthcheck, { PORT: String(closedPort) }).exited,
        ),
      ).toMatchObject({ code: 1, stdout: "", stderr: "" });
    });
  });

  it.each(["stalled", "trickling"] as const)(
    "enforces an absolute two-second bound on a %s response",
    async (mode) => {
      let requests = 0;
      await withProbeServer(
        (_request, reply) => {
          requests++;
          if (mode === "trickling") {
            reply.writeHead(200);
            reply.write("x");
            const timer = setInterval(() => reply.write("x"), 30);
            reply.once("close", () => clearInterval(timer));
          }
        },
        async (port) => {
          await withProcessSandbox(async (sandbox) => {
            const started = performance.now();
            const result = await withinProcess(
              sandbox.start(compiledHealthcheck, { PORT: String(port) }).exited,
            );
            const elapsed = performance.now() - started;
            expect(result).toMatchObject({ code: 1, stdout: "", stderr: "" });
            expect(requests).toBe(1);
            expect(elapsed).toBeGreaterThanOrEqual(1800);
            expect(elapsed).toBeLessThan(4000);
          });
        },
      );
    },
  );
});

// Windows child.kill does not deliver these POSIX signals to the registered JavaScript handlers.
describe.skipIf(process.platform === "win32")("compiled POSIX shutdown handlers", () => {
  it("completes an admitted upload during SIGTERM grace and exits zero after disposal", async () => {
    await withProcessSandbox(async (sandbox) => {
      const service = await sandbox.server({ SHUTDOWN_GRACE_MS: "2000" });
      const body = multipart(await audioBytes());
      const upload = openProcessUpload(`${service.url}/file-upload`, {
        ...uploadHeaders,
        "transfer-encoding": "chunked",
      });
      try {
        upload.request.write(body.subarray(0, body.length - 8));
        await vi.waitFor(
          async () => expect(await readdir(sandbox.directory)).toHaveLength(1),
          eventually,
        );
        service.process.child.kill("SIGTERM");
        await service.process.event("shutdown_started");
        upload.request.end(body.subarray(body.length - 8));
        const response = await withinProcess(upload.response);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ frameCount: 21 });
        expect(await withinProcess(service.process.exited)).toMatchObject({
          code: 0,
          signal: null,
        });
        expect(await readdir(sandbox.directory)).toEqual([]);
        expect(
          service.process.records().filter((record) => record.event === "shutdown_started"),
        ).toHaveLength(1);
        expect(service.process.records().some((record) => record.event === "shutdown_forced")).toBe(
          false,
        );
      } finally {
        upload.request.destroy();
      }
    });
  });

  it("cancels an unfinished upload after SIGINT grace and exits zero when cleanup settles", async () => {
    await withProcessSandbox(async (sandbox) => {
      const service = await sandbox.server({ SHUTDOWN_GRACE_MS: "150" });
      const upload = openProcessUpload(`${service.url}/file-upload`, {
        ...uploadHeaders,
        "transfer-encoding": "chunked",
      });
      try {
        const body = multipart(await audioBytes());
        upload.request.write(body.subarray(0, body.indexOf("\r\n\r\n") + 8));
        await vi.waitFor(
          async () => expect(await readdir(sandbox.directory)).toHaveLength(1),
          eventually,
        );
        service.process.child.kill("SIGINT");
        await service.process.event("shutdown_forced");
        await expect(withinProcess(upload.response)).rejects.toThrow();
        expect(await withinProcess(service.process.exited)).toMatchObject({
          code: 0,
          signal: null,
        });
        expect(await readdir(sandbox.directory)).toEqual([]);
      } finally {
        upload.request.destroy();
      }
    });
  });

  it("keeps the final bound alive for unsettled disposal despite repeated signals", async () => {
    await withProcessSandbox(async (sandbox) => {
      const service = await sandbox.server(
        { SHUTDOWN_GRACE_MS: "100", REQUEST_TIMEOUT_MS: "200" },
        disposalServer,
        ["hang"],
      );
      const upload = openProcessUpload(`${service.url}/file-upload`, uploadHeaders);
      let repeatedSignal: NodeJS.Timeout | undefined;
      try {
        upload.request.end(multipart(await audioBytes()));
        await service.process.event("fixture_disposal_started");
        const started = performance.now();
        service.process.child.kill("SIGTERM");
        await service.process.event("shutdown_started");
        // A reset-on-signal implementation could never finish while this parent keeps signalling.
        repeatedSignal = setInterval(() => service.process.child.kill("SIGINT"), 40);
        await service.process.event("shutdown_forced");
        const result = await withinProcess(service.process.exited);
        const elapsed = performance.now() - started;
        expect(result).toMatchObject({ code: 1, signal: null });
        expect(elapsed).toBeGreaterThanOrEqual(950);
        expect(elapsed).toBeLessThan(3000);
        expect(
          service.process.records().filter((record) => record.event === "shutdown_started"),
        ).toHaveLength(1);
        expect(
          service.process.records().filter((record) => record.event === "shutdown_forced"),
        ).toHaveLength(1);
        expect(service.process.records().some((record) => record.event === "shutdown_failed")).toBe(
          true,
        );
        expect(await readdir(sandbox.directory)).toHaveLength(1);
      } finally {
        clearInterval(repeatedSignal);
        upload.request.destroy();
      }
    });
  });
});

async function withProbeServer(
  handler: RequestListener,
  inspect: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("No listening probe port.");
    await inspect(address.port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
