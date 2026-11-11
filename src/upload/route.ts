import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { finished, pipeline } from "node:stream/promises";
import { MIMEType } from "node:util";
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { countFrames } from "../mp3/count.ts";
import type { UploadAdmission } from "./admission.ts";
import { describeUploadError, discardRejectedBody, sendUploadError, UploadError } from "./error.ts";
import { beginUpload, type UploadLifetime } from "./lifetime.ts";

interface UploadSettings {
  readonly tempDirectory: string;
  readonly maxFileBytes: number;
  readonly timeoutMs: number;
}

/** Only asynchronous work whose timing/failure matters to ownership is replaceable in tests. */
export interface UploadOperations {
  count(path: string, signal: AbortSignal): Promise<number>;
  dispose(directory: string): Promise<void>;
}

export function registerUploadRoute(
  app: FastifyInstance,
  settings: UploadSettings,
  admission: UploadAdmission,
  overrides: Partial<UploadOperations>,
): void {
  const operations: UploadOperations = {
    count: countFrames,
    dispose: (directory) => rm(directory, { recursive: true, force: true }),
    ...overrides,
  };
  const lifetimes = new WeakMap<FastifyRequest, UploadLifetime>();
  app.register(multipart, {
    limits: { files: 1, fields: 0, parts: 1, fileSize: settings.maxFileBytes, headerPairs: 32 },
  });
  app.addHook("onResponse", async (request) => lifetimes.get(request)?.finish());
  app.setErrorHandler(async (error: unknown, request, reply) => {
    const problem = describeUploadError(error);
    const lifetime = lifetimes.get(request);
    try {
      // The cancellation owner has already responded or observed a disconnected peer.
      if (lifetime?.signal.aborted) return;
      if (lifetime && !reply.sent) {
        await lifetime.run(async () => {
          const discarded = discardRejectedBody(request.raw, lifetime.signal);
          sendUploadError(request, reply, problem);
          await discarded;
        });
      } else {
        sendUploadError(request, reply, problem);
      }
    } finally {
      lifetime?.finish();
    }
  });
  app.post(
    "/file-upload",
    {
      onRequest: async (request, reply) => {
        const permit = admission.tryAcquire();
        if (!permit) {
          throw new UploadError(
            503,
            admission.accepting
              ? "Upload capacity is full. Try again."
              : "The service is draining.",
            true,
          );
        }
        lifetimes.set(request, beginUpload(request, reply, permit, settings.timeoutMs));
        validateMultipartHeaders(request);
      },
      schema: {
        response: {
          200: {
            type: "object",
            required: ["frameCount"],
            additionalProperties: false,
            properties: { frameCount: { type: "integer", minimum: 1 } },
          },
        },
      },
    },
    async (request, reply) => {
      const lifetime = lifetimes.get(request);
      if (!lifetime) throw new Error("Upload admission has not been initialized.");
      try {
        const frameCount = await lifetime.run(async () => {
          const directory = await mkdtemp(join(settings.tempDirectory, "mp3-"));
          try {
            // The client filename is never used as a path or logged.
            const path = join(directory, "upload.mp3");
            await receiveUpload(request, path, lifetime.signal);
            return await operations.count(path, lifetime.signal);
          } finally {
            // Cancellation must not skip the attempt to remove private uploaded data.
            await operations.dispose(directory);
          }
        });
        lifetime.finish();
        if (!lifetime.signal.aborted && !reply.sent && !reply.raw.destroyed) return { frameCount };
      } catch (error) {
        if (!lifetime.signal.aborted && !reply.sent && !reply.raw.destroyed) throw error;
        lifetime.finish();
      }
    },
  );
}

function validateMultipartHeaders(request: FastifyRequest): void {
  const encoding = request.headers["content-encoding"];
  if (encoding !== undefined && encoding.toLowerCase() !== "identity") {
    throw new UploadError(415, "Content-Encoding must be absent or identity.");
  }
  let type: MIMEType;
  try {
    type = new MIMEType(request.headers["content-type"] ?? "");
  } catch {
    throw new UploadError(415, "Use multipart/form-data with one file field named file.");
  }
  if (type.essence !== "multipart/form-data") {
    throw new UploadError(415, "Use multipart/form-data with one file field named file.");
  }
  const boundary = type.params.get("boundary");
  // RFC 2046 bounds the delimiter and excludes a trailing space.
  if (!boundary || !/^[0-9A-Za-z'()+_,./:=? -]{1,70}$/.test(boundary) || boundary.endsWith(" ")) {
    throw new UploadError(400, "Provide a valid multipart boundary.");
  }
  // Pass one canonical parameter to prevent MIME/parser interpretation differences.
  request.headers["content-type"] = `multipart/form-data; boundary="${boundary}"`;
}

async function receiveUpload(
  request: FastifyRequest,
  path: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  let received = false;
  for await (const part of request.parts()) {
    if (part.type !== "file" || part.fieldname !== "file") {
      if (part.type === "file") part.file.destroy();
      throw new UploadError(400, "Expected exactly one file field named file.");
    }
    await pipeline(part.file, createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal });
    if (part.file.truncated) throw new UploadError(413, "The file exceeds the upload limit.");
    received = true;
  }
  // A closing multipart delimiter does not establish that the HTTP epilogue ended.
  const bodyComplete = finished(request.raw, {
    readable: true,
    writable: false,
    cleanup: true,
    signal,
  });
  request.raw.resume();
  await bodyComplete;
  signal.throwIfAborted();
  if (!received) throw new UploadError(400, "Expected exactly one file field named file.");
}
