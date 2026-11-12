import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from "fastify";
import { type AppOptions, resolveAppSettings } from "./config.ts";
import { logEvent, loggingOptions, requestRoute } from "./logging.ts";
import { UploadAdmission } from "./upload/admission.ts";
import { registerUploadRoute, type UploadOperations } from "./upload/route.ts";

export type { AppOptions } from "./config.ts";

export interface Application {
  readonly app: FastifyInstance;
  readonly admission: UploadAdmission;
}

/** Construct an independent application without opening a listening socket. */
export function createApp(
  options: AppOptions = {},
  operations: Partial<UploadOperations> = {},
): Application {
  const settings = resolveAppSettings(options);
  const admission = new UploadAdmission(settings.maxUploads);
  let storageProbe: Promise<void> | undefined;
  const checkStorage = (): Promise<void> => {
    // Share only in-flight work; the next completed readiness check probes storage again.
    storageProbe ??= probeStorage(settings.tempDirectory).finally(() => {
      storageProbe = undefined;
    });
    return storageProbe;
  };
  let rootLogger: FastifyBaseLogger | undefined;
  const app = Fastify({
    logger: loggingOptions(settings.logLevel, () => rootLogger),
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    requestTimeout: 0,
    connectionTimeout: 0,
    return503OnClosing: false,
    forceCloseConnections: "idle",
  });
  rootLogger = app.log;
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.addHook("onResponse", async (request, reply) => {
    logEvent(request.log, {
      event: "request_completed",
      requestId: request.id,
      route: requestRoute(request.routeOptions.url),
      statusCode: reply.statusCode,
      elapsedMs: Math.max(0, Math.round(reply.elapsedTime)),
    });
  });
  app.addHook("onReady", checkStorage);
  app.addHook("preClose", async () => admission.stop());
  app.addHook("onClose", () => admission.drained());
  app.addHook("onSend", async (_request, reply, payload) => {
    if (!admission.accepting) reply.header("connection", "close");
    return payload;
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    if (admission.accepting) {
      try {
        await checkStorage();
        if (admission.accepting) return { status: "ready" };
      } catch {
        // Report dependency availability without exposing filesystem details.
      }
    }
    reply.code(503);
    return { status: "not-ready" };
  });
  // Encapsulation keeps upload error policy local to this endpoint.
  app.register(async (scope) => registerUploadRoute(scope, settings, admission, operations));
  return { app, admission };
}

async function probeStorage(parent: string): Promise<void> {
  const directory = await mkdtemp(join(parent, "probe-"));
  try {
    await writeFile(join(directory, "ready"), "ready", { flag: "wx", mode: 0o600 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
