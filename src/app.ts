import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  let storageProbe: Promise<void> | undefined;
  const checkStorage = (): Promise<void> => {
    // Share only in-flight work; the next completed readiness check probes storage again.
    storageProbe ??= probeStorage(settings.tempDirectory).finally(() => {
      storageProbe = undefined;
    });
    return storageProbe;
  };
  const app = Fastify({
    logger: false,
    requestTimeout: 0,
    connectionTimeout: 0,
    return503OnClosing: false,
    forceCloseConnections: "idle",
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
