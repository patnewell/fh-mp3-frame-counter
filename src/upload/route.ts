import { finished } from "node:stream/promises";
import { MIMEType } from "node:util";
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { logEvent } from "../logging.ts";
import { countFrames } from "../mp3/count.ts";
import type { UploadAdmission } from "./admission.ts";
import { describeUploadError, discardRejectedBody, sendUploadError, UploadError } from "./error.ts";
import { beginUpload, type UploadLifetime } from "./lifetime.ts";

interface UploadSettings {
  readonly maxFileBytes: number;
  readonly timeoutMs: number;
}

/** Only asynchronous work whose timing/failure matters to ownership is replaceable in tests. */
export interface UploadOperations {
  count(input: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<number>;
}

export function registerUploadRoute(
  app: FastifyInstance,
  settings: UploadSettings,
  admission: UploadAdmission,
  overrides: Partial<UploadOperations>,
): void {
  const operations: UploadOperations = {
    count: countFrames,
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
          try {
            return await countUpload(request, operations.count, lifetime.signal);
          } catch (error) {
            const cancelled =
              lifetime.signal.aborted &&
              (error === lifetime.signal.reason ||
                (error instanceof Error && error.name === "AbortError"));
            if (!cancelled && describeUploadError(error).status === 500) {
              logEvent(request.log, {
                event: "upload_failed",
                requestId: request.id,
                category: "processing",
              });
            }
            throw error;
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

async function countUpload(
  request: FastifyRequest,
  count: UploadOperations["count"],
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();
  let frameCount: number | undefined;
  for await (const part of request.parts()) {
    if (part.type !== "file" || part.fieldname !== "file") {
      if (part.type === "file") {
        const settled = finished(part.file, { cleanup: true }).catch(() => undefined);
        part.file.destroy();
        await settled;
      }
      throw new UploadError(400, "Expected exactly one file field named file.");
    }
    // The lifetime owns both promises. Cancellation closes a blocked source read,
    // but cannot release capacity while a counter that ignores it is still pending.
    const settled = finished(part.file, { cleanup: true });
    void settled.catch(() => undefined);
    const cancel = (): void => {
      part.file.destroy();
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      try {
        frameCount = await count(part.file, signal);
      } catch (error) {
        if (part.file.truncated) throw new UploadError(413, "The file exceeds the upload limit.");
        throw error;
      }
      if (part.file.truncated) throw new UploadError(413, "The file exceeds the upload limit.");
      if (!part.file.readableEnded) throw new Error("The counter returned before file EOF.");
      await settled;
    } finally {
      if (!part.file.readableEnded) part.file.destroy();
      await settled.catch(() => undefined);
      signal.removeEventListener("abort", cancel);
    }
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
  if (frameCount === undefined)
    throw new UploadError(400, "Expected exactly one file field named file.");
  return frameCount;
}
