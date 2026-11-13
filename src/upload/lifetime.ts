import type { FastifyReply, FastifyRequest } from "fastify";
import type { UploadPermit } from "./admission.ts";
import { describeUploadError, sendUploadError, UploadError } from "./error.ts";

/** Request-owned cancellation and accounting for asynchronous work. */
export interface UploadLifetime {
  /** Cooperatively cancels work on deadline or disconnect; abort alone does not release capacity. */
  readonly signal: AbortSignal;
  /** Track work through settlement. The callback must await any stream or other cleanup it starts. */
  run<T>(work: () => Promise<T>): Promise<T>;
  /** Prevent new work and release capacity once pending work settles. Does not cancel work. */
  finish(): void;
}

/**
 * Take ownership of an admitted request's permit, deadline and transport listeners.
 * Releasing capacity requires both finish() and settlement of every run() callback.
 * This lets a timeout send an error promptly while a slow counter still holds its slot.
 */
export function beginUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  permit: UploadPermit,
  timeoutMs: number,
): UploadLifetime {
  const controller = new AbortController();
  let pendingOperations = 0;
  let finishRequested = false;
  let released = false;

  function releaseIfIdle(): void {
    if (!finishRequested || pendingOperations !== 0 || released) return;
    released = true;
    clearTimeout(deadlineTimer);
    request.raw.off("close", requestClosed);
    reply.raw.off("close", responseClosed);
    permit.release();
  }

  function finish(): void {
    finishRequested = true;
    releaseIfIdle();
  }

  function disconnect(): void {
    controller.abort(new Error("The client disconnected."));
    finish();
  }

  function requestClosed(): void {
    // A normal request-body close can precede parsing completion, so it must not cancel work.
    if (!request.raw.complete) disconnect();
  }

  function responseClosed(): void {
    // A response that finished writing closed normally; an earlier close is a disconnect.
    if (!reply.raw.writableFinished) disconnect();
  }

  const deadlineTimer = setTimeout(() => {
    const error = new UploadError(503, "The upload deadline expired.");
    controller.abort(error);
    sendUploadError(request, reply, describeUploadError(error));
    finish();
  }, timeoutMs);
  // An idle deadline must not keep the process alive after its other work is gone.
  deadlineTimer.unref();
  request.raw.on("close", requestClosed);
  reply.raw.on("close", responseClosed);
  // Cover a disconnect that occurred before these listeners were installed.
  if (request.raw.destroyed && !request.raw.complete) disconnect();
  if (reply.raw.destroyed && !reply.raw.writableFinished) disconnect();

  return {
    signal: controller.signal,
    async run<T>(work: () => Promise<T>): Promise<T> {
      controller.signal.throwIfAborted();
      if (finishRequested) throw new Error("The upload lifetime has already finished.");
      pendingOperations++;
      try {
        return await work();
      } finally {
        pendingOperations--;
        releaseIfIdle();
      }
    },
    finish,
  };
}
