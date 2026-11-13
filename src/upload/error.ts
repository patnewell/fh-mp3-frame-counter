import type { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import { InvalidMp3Error } from "../mp3/error.ts";

// This allowance limits rejection cleanup, not the size of a valid upload.
const REJECTED_BODY_BYTE_LIMIT = 64 * 1024;

type ClientStatus = 400 | 413 | 415 | 503;

/** An expected upload rejection with a message safe to return to the client. */
export class UploadError extends Error {
  readonly status: ClientStatus;
  /** Busy/draining responses ask the client to retry; deadline errors do not. */
  readonly retryable: boolean;

  constructor(status: ClientStatus, message: string, retryable = false) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.retryable = retryable;
  }
}

/** Public response fields, kept separate from internal exceptions and logging. */
export interface UploadProblem {
  readonly status: ClientStatus | 500;
  readonly message: string;
  readonly retryAfter?: 1;
}

/** Map failures to safe responses without exposing parser or dependency details. */
export function describeUploadError(error: unknown): UploadProblem {
  if (error instanceof UploadError) {
    return {
      status: error.status,
      message: error.message,
      ...(error.retryable ? { retryAfter: 1 } : {}),
    };
  }
  if (error instanceof InvalidMp3Error) {
    return {
      status: 400,
      message: "The file is not a complete supported MPEG-1 Layer III stream.",
    };
  }
  // Dependency errors need not inherit from Error; inspect only their public code.
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
  if (
    typeof code === "string" &&
    ["FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"].includes(code)
  ) {
    return { status: 413, message: "The upload exceeds a multipart limit." };
  }
  if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
    return { status: 415, message: "Use multipart/form-data with one file field named file." };
  }
  // Multipart failures use codes where available; the underlying parser also emits
  // these two message-only errors. Keep the match exact so unrelated failures stay 500.
  if (
    code === "FST_PROTO_VIOLATION" ||
    code === "FST_INVALID_JSON_FIELD_ERROR" ||
    code === "FST_MP_PREMATURE_CLOSE" ||
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    (error instanceof Error &&
      /^(Unexpected end of multipart data|Part terminated early due to unexpected end of multipart data)$/.test(
        error.message,
      ))
  ) {
    return { status: 400, message: "The multipart body is incomplete or malformed." };
  }
  return { status: 500, message: "The upload could not be processed." };
}

/**
 * Send at most one rejection, then close rather than reuse a connection with unread input.
 * Waiting for response finish gives the client a chance to receive the JSON, though a
 * client still sending may see a reset. This function does not await body cleanup.
 */
export function sendUploadError(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: UploadProblem,
): void {
  if (reply.sent || reply.raw.destroyed) return;
  if (problem.retryAfter !== undefined) reply.header("retry-after", problem.retryAfter);
  reply.header("connection", "close");
  reply.raw.once("finish", () => request.raw.destroy());
  reply.code(problem.status).send({ error: problem.message });
}

/**
 * Best-effort cleanup for an admitted rejection, bounded by bytes and its lifetime signal.
 * The data listener observes whole chunks, so consumption can exceed 64 KiB by one chunk.
 * Callers await this promise inside lifetime.run() to account for rejection cleanup.
 */
export async function discardRejectedBody(input: Readable, signal: AbortSignal): Promise<void> {
  if (input.readableEnded || input.destroyed) return;
  let discardedBytes = 0;
  const stopReading = (): void => {
    // Pause first because destroy() can still deliver a prefetched chunk in flowing mode.
    input.pause();
    input.destroy();
  };
  const consume = (chunk: Buffer): void => {
    discardedBytes += chunk.length;
    if (discardedBytes > REJECTED_BODY_BYTE_LIMIT) stopReading();
  };
  // Observe completion before starting flow or destroying the stream, so neither is missed.
  const completed = finished(input, { readable: true, writable: false, cleanup: true, signal });
  signal.addEventListener("abort", stopReading, { once: true });
  input.on("data", consume);
  if (signal.aborted) stopReading();
  else input.resume();
  try {
    // A discard failure must not replace the original upload error.
    await completed.catch(() => undefined);
  } finally {
    input.off("data", consume);
    signal.removeEventListener("abort", stopReading);
  }
}
