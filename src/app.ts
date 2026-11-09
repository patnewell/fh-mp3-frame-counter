import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { registerUploadRoute } from "./upload/route.ts";

export interface AppOptions {
  readonly tempDirectory?: string;
  readonly maxFileBytes?: number;
}

/** Construct an independent application without opening a listening socket. */
export function createApp(options: AppOptions = {}): FastifyInstance {
  const maxFileBytes = options.maxFileBytes ?? 100 * 1024 * 1024;
  const tempDirectory = options.tempDirectory ?? tmpdir();
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new RangeError("maxFileBytes must be a positive safe integer.");
  }
  if (!isAbsolute(tempDirectory) || tempDirectory.includes("\0")) {
    throw new Error("tempDirectory must be an absolute directory path.");
  }

  const app = Fastify({ logger: false });
  // Encapsulation keeps upload error policy local to this endpoint.
  app.register(async (scope) => registerUploadRoute(scope, { maxFileBytes, tempDirectory }));
  return app;
}
