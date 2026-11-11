import type { FastifyReply, FastifyRequest } from "fastify";
import type { UploadPermit } from "./admission.ts";
import { describeUploadError, sendUploadError, UploadError } from "./error.ts";

export interface UploadLifetime {
  readonly signal: AbortSignal;
  run<T>(work: () => Promise<T>): Promise<T>;
  finish(): void;
}

/** The permit follows settled work, even when a response or cancellation happens first. */
export function beginUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  permit: UploadPermit,
  timeoutMs: number,
): UploadLifetime {
  const controller = new AbortController();
  let operations = 0;
  let finishing = false;
  let released = false;

  function releaseIfIdle(): void {
    if (!finishing || operations !== 0 || released) return;
    released = true;
    clearTimeout(timer);
    request.raw.off("close", requestClosed);
    reply.raw.off("close", responseClosed);
    permit.release();
  }

  function finish(): void {
    finishing = true;
    releaseIfIdle();
  }

  function disconnect(): void {
    controller.abort(new Error("The client disconnected."));
    finish();
  }

  function requestClosed(): void {
    // IncomingMessage also emits close after an ordinarily completed body.
    if (!request.raw.complete) disconnect();
  }

  function responseClosed(): void {
    if (!reply.raw.writableFinished) disconnect();
  }

  const timer = setTimeout(() => {
    const error = new UploadError(503, "The upload deadline expired.");
    controller.abort(error);
    sendUploadError(request, reply, describeUploadError(error));
    finish();
  }, timeoutMs);
  timer.unref();
  request.raw.on("close", requestClosed);
  reply.raw.on("close", responseClosed);
  if (request.raw.destroyed && !request.raw.complete) disconnect();
  if (reply.raw.destroyed && !reply.raw.writableFinished) disconnect();

  return {
    signal: controller.signal,
    async run<T>(work: () => Promise<T>): Promise<T> {
      controller.signal.throwIfAborted();
      if (finishing) throw new Error("The upload lifetime has already finished.");
      operations++;
      try {
        return await work();
      } finally {
        operations--;
        releaseIfIdle();
      }
    },
    finish,
  };
}
