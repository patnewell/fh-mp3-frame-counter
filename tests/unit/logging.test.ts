import Fastify, { type FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import type { LogLevel } from "../../src/config.ts";
import { logEvent, loggingOptions, requestRoute } from "../../src/logging.ts";

const requestId = "00000000-0000-4000-8000-000000000001";

/** Exercise the configured Pino output boundary, including framework-style calls. */
async function captureLogs(
  write: (logger: FastifyBaseLogger) => void,
  level: LogLevel = "trace",
): Promise<string[]> {
  const lines: string[] = [];
  let rootLogger: FastifyBaseLogger | undefined;
  const app = Fastify({
    logger: {
      ...loggingOptions(level, () => rootLogger),
      stream: { write: (line) => lines.push(line) },
    },
  });
  rootLogger = app.log;
  try {
    write(app.log);
    return lines;
  } finally {
    await app.close();
  }
}

describe("allowlisted operational logs", () => {
  it("keeps typed events and applies their declared severity", async () => {
    const lines = await captureLogs((logger) => {
      logEvent(logger, { event: "server_started", port: 3000 });
      logEvent(logger, { event: "shutdown_started", activeUploads: 1 });
      logEvent(logger, { event: "shutdown_forced", activeUploads: 1 });
      logEvent(logger, { event: "upload_failed", requestId, category: "processing" });
      logEvent(logger, { event: "upload_failed", requestId, category: "cleanup" });
      logEvent(logger, { event: "server_stopped" });
      logEvent(logger, { event: "startup_failed" });
      logEvent(logger, { event: "shutdown_failed" });
    });
    expect(lines.map((line): unknown => JSON.parse(line))).toEqual([
      expect.objectContaining({ level: 30, event: "server_started", port: 3000 }),
      expect.objectContaining({ level: 30, event: "shutdown_started", activeUploads: 1 }),
      expect.objectContaining({ level: 40, event: "shutdown_forced", activeUploads: 1 }),
      expect.objectContaining({
        level: 50,
        event: "upload_failed",
        requestId,
        category: "processing",
      }),
      expect.objectContaining({
        level: 50,
        event: "upload_failed",
        requestId,
        category: "cleanup",
      }),
      expect.objectContaining({ level: 30, event: "server_stopped" }),
      expect.objectContaining({ level: 50, event: "startup_failed" }),
      expect.objectContaining({ level: 50, event: "shutdown_failed" }),
    ]);
  });

  it("removes private fields, arbitrary messages and child bindings even at trace", async () => {
    const secret = "PRIVATE_UPLOAD_DATA";
    const lines = await captureLogs((logger) => {
      logger.trace(secret);
      logger.error({ err: new Error(secret), req: { url: `/${secret}`, headers: { secret } } });
      logger.info({ event: "unknown", path: secret }, secret);
      logger
        .child({ filename: secret, reqId: secret })
        .child({ headers: { secret } })
        .info(
          {
            event: "request_completed",
            requestId,
            route: "upload",
            statusCode: 200,
            elapsedMs: 12,
            filename: secret,
            headers: { secret },
            err: new Error(secret),
          },
          secret,
        );
    });
    expect(lines).toHaveLength(1);
    expect(lines.join("")).not.toContain(secret);
    expect(JSON.parse(lines[0] ?? "null")).toEqual({
      level: 30,
      time: expect.any(Number),
      event: "request_completed",
      requestId,
      route: "upload",
      statusCode: 200,
      elapsedMs: 12,
    });
  });

  it("drops events before the application assigns its root logger", async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: {
        ...loggingOptions("trace", () => undefined),
        stream: { write: (line) => lines.push(line) },
      },
    });
    try {
      logEvent(app.log, { event: "server_started", port: 3000 });
      expect(lines).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it.each([
    null,
    undefined,
    "arbitrary message",
    { event: "unknown" },
    { event: "server_started", port: 0 },
    { event: "server_started", port: 65_536 },
    { event: "server_started", port: 3000.5 },
    { event: "server_started", port: "3000" },
    { event: "shutdown_started", activeUploads: -1 },
    { event: "shutdown_forced", activeUploads: Number.POSITIVE_INFINITY },
    { event: "upload_failed", requestId: "client-supplied", category: "processing" },
    { event: "upload_failed", requestId, category: "private exception text" },
    {
      event: "request_completed",
      requestId,
      route: "/private/path",
      statusCode: 200,
      elapsedMs: 1,
    },
    { event: "request_completed", requestId, route: "upload", statusCode: 0, elapsedMs: 1 },
    { event: "request_completed", requestId, route: "upload", statusCode: 600, elapsedMs: 1 },
    {
      event: "request_completed",
      requestId,
      route: "upload",
      statusCode: 200,
      elapsedMs: Number.NaN,
    },
  ])("drops malformed event %#", async (value) => {
    const lines = await captureLogs((logger) => logger.info(value));
    expect(lines).toEqual([]);
  });

  it("respects the configured level and silent mode", async () => {
    const write = (logger: FastifyBaseLogger): void => {
      logEvent(logger, { event: "server_started", port: 3000 });
      logEvent(logger, { event: "shutdown_forced", activeUploads: 1 });
    };
    const lines = await captureLogs(write, "warn");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("shutdown_forced");
    expect(await captureLogs(write, "silent")).toEqual([]);
  });

  it.each([
    ["/file-upload", "upload"],
    ["/health/live", "live"],
    ["/health/ready", "ready"],
    ["/private-query?secret=value", "unmatched"],
    [undefined, "unmatched"],
  ])("uses only a fixed route label for %s", (route, expected) => {
    expect(requestRoute(route)).toBe(expected);
  });
});
