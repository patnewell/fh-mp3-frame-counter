import type { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { MIMEType } from "node:util";
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { countFrames } from "../mp3/count.ts";
import type { UploadAdmission } from "./admission.ts";
import { describeUploadError, discardRejectedBody, sendUploadError, UploadError } from "./error.ts";
import { beginUpload, type UploadLifetime } from "./lifetime.ts";

interface UploadSettings {
  readonly timeoutMs: number;
}

/** Tests can replace the counter to control failures and cancellation timing. */
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
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
      // Omitting this option would restore the plugin's default file-size cap.
      fileSize: Number.POSITIVE_INFINITY,
      headerPairs: 32,
    },
  });
  app.addHook("onResponse", async (request) => lifetimes.get(request)?.finish());
  app.setErrorHandler(async (error: unknown, request, reply) => {
    const problem = describeUploadError(error);
    const lifetime = lifetimes.get(request);
    try {
      // The lifetime handles the timeout response or client disconnect.
      if (lifetime?.signal.aborted) return;
      if (lifetime && !reply.sent) {
        await lifetime.run(async () => {
          const bodyDiscarded = discardRejectedBody(request.raw, lifetime.signal);
          sendUploadError(request, reply, problem);
          // Sending the response does not release capacity while discard work is pending.
          await bodyDiscarded;
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
              request.log.error({
                event: "upload_failed",
                requestId: request.id,
                category: "processing",
                err: error,
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
  // RFC 2046 permits 1–70 boundary characters, with no trailing space.
  if (!boundary || !/^[0-9A-Za-z'()+_,./:=? -]{1,70}$/.test(boundary) || boundary.endsWith(" ")) {
    throw new UploadError(400, "Provide a valid multipart boundary.");
  }
  // Normalize the header so MIMEType and the multipart parser use the same boundary.
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
        const fileClosed = finished(part.file, { cleanup: true }).catch(() => undefined);
        part.file.destroy();
        await fileClosed;
      }
      throw new UploadError(400, "Expected exactly one file field named file.");
    }
    frameCount = await countFile(part.file, count, signal);
  }
  // Multipart can end before the HTTP body. Wait for any epilogue before reporting success.
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

async function countFile(
  file: Readable,
  count: UploadOperations["count"],
  signal: AbortSignal,
): Promise<number> {
  const fileFinished = finished(file, { cleanup: true });
  // Prevent an unhandled rejection if the file fails before the counter settles.
  void fileFinished.catch(() => undefined);
  const cancel = (): void => {
    // Interrupt a source read that cannot observe the abort signal itself.
    file.destroy();
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    // Await the counter even after cancellation so the lifetime keeps its capacity slot.
    const frameCount = await count(file, signal);
    if (!file.readableEnded) throw new Error("The counter returned before file EOF.");
    await fileFinished;
    return frameCount;
  } finally {
    if (!file.readableEnded) file.destroy();
    await fileFinished.catch(() => undefined);
    signal.removeEventListener("abort", cancel);
  }
}
