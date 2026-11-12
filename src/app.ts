import { randomUUID } from "node:crypto";
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
  app.addHook("preClose", async () => admission.stop());
  app.addHook("onClose", async () => admission.drained());
  app.addHook("onSend", async (_request, reply, payload) => {
    if (!admission.accepting) reply.header("connection", "close");
    return payload;
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    if (admission.accepting) {
      return { status: "ready" };
    }
    reply.code(503);
    return { status: "not-ready" };
  });
  // Encapsulation keeps upload error policy local to this endpoint.
  app.register(async (scope) => registerUploadRoute(scope, settings, admission, operations));
  return { app, admission };
}
