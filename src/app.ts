import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { type AppOptions, resolveAppSettings } from "./config.ts";
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
  const app = Fastify({
    logger: { level: settings.logLevel },
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    requestTimeout: 0,
    connectionTimeout: 0,
    return503OnClosing: false,
    forceCloseConnections: "idle",
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
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
