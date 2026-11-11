import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { UploadAdmission } from "./upload/admission.ts";
import { registerUploadRoute, type UploadOperations } from "./upload/route.ts";

export interface AppOptions {
  readonly tempDirectory?: string;
  readonly maxFileBytes?: number;
  readonly maxUploads?: number;
  readonly timeoutMs?: number;
}

export interface Application {
  readonly app: FastifyInstance;
  readonly admission: UploadAdmission;
}

/** Construct an independent application without opening a listening socket. */
export function createApp(
  options: AppOptions = {},
  operations: Partial<UploadOperations> = {},
): Application {
  const maxFileBytes = options.maxFileBytes ?? 100 * 1024 * 1024;
  const tempDirectory = options.tempDirectory ?? tmpdir();
  const maxUploads = options.maxUploads ?? 4;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new RangeError("maxFileBytes must be a positive safe integer.");
  }
  if (!isAbsolute(tempDirectory) || tempDirectory.includes("\0")) {
    throw new Error("tempDirectory must be an absolute directory path.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError("timeoutMs must be a positive integer within the Node timer range.");
  }

  const admission = new UploadAdmission(maxUploads);
  const settings = Object.freeze({ maxFileBytes, tempDirectory, timeoutMs });
  const app = Fastify({
    logger: false,
    requestTimeout: 0,
    connectionTimeout: 0,
    return503OnClosing: false,
    forceCloseConnections: "idle",
  });
  app.addHook("preClose", async () => admission.stop());
  app.addHook("onClose", () => admission.drained());
  app.addHook("onSend", async (_request, reply, payload) => {
    if (!admission.accepting) reply.header("connection", "close");
    return payload;
  });
  // Encapsulation keeps upload error policy local to this endpoint.
  app.register(async (scope) => registerUploadRoute(scope, settings, admission, operations));
  return { app, admission };
}
