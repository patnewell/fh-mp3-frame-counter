import type { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import { InvalidMp3Error } from "../mp3/error.ts";

type ClientStatus = 400 | 413 | 415 | 503;

/** An expected transport rejection whose message is safe to return to a client. */
export class UploadError extends Error {
  readonly status: ClientStatus;
  readonly retryable: boolean;

  constructor(status: ClientStatus, message: string, retryable = false) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.retryable = retryable;
  }
}

export interface UploadProblem {
  readonly status: ClientStatus | 500;
  readonly message: string;
  readonly retryAfter?: 1;
}

/** Dependency and filesystem exception text must never become a public error. */
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
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
  if (
    typeof code === "string" &&
    ["FST_REQ_FILE_TOO_LARGE", "FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"].includes(
      code,
    )
  ) {
    return { status: 413, message: "The upload exceeds a file or multipart limit." };
  }
  if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
    return { status: 415, message: "Use multipart/form-data with one file field named file." };
  }
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

/** Flush a small rejection before closing a sender that may still be uploading. */
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

/** Discard at most 64 KiB plus one delivered chunk; abort/closure also ends consumption. */
export async function discardRejectedBody(input: Readable, signal: AbortSignal): Promise<void> {
  if (input.readableEnded || input.destroyed) return;
  let received = 0;
  const close = (): void => {
    // Destroy alone can still deliver a prefetched chunk in flowing mode.
    input.pause();
    input.destroy();
  };
  const consume = (chunk: Buffer): void => {
    received += chunk.length;
    if (received > 65_536) close();
  };
  const completed = finished(input, { readable: true, writable: false, cleanup: true, signal });
  signal.addEventListener("abort", close, { once: true });
  input.on("data", consume);
  if (signal.aborted) close();
  else input.resume();
  try {
    // Rejected input is disposable; transport failure is another completed discard path.
    await completed.catch(() => undefined);
  } finally {
    input.off("data", consume);
    signal.removeEventListener("abort", close);
  }
}
