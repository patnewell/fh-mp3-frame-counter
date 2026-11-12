import type { FastifyBaseLogger, FastifyServerOptions } from "fastify";
import type { LogLevel } from "./config.ts";

type RequestRoute = "upload" | "live" | "ready" | "unmatched";
type LoggerOptions = Exclude<FastifyServerOptions["logger"], boolean | undefined>;

export type ServiceEvent =
  | { readonly event: "server_started"; readonly port: number }
  | { readonly event: "shutdown_started" | "shutdown_forced"; readonly activeUploads: number }
  | { readonly event: "server_stopped" | "startup_failed" | "shutdown_failed" }
  | {
      readonly event: "request_completed";
      readonly requestId: string;
      readonly route: RequestRoute;
      readonly statusCode: number;
      readonly elapsedMs: number;
    }
  | {
      readonly event: "upload_failed";
      readonly requestId: string;
      readonly category: "processing";
    };

/** Reconstruct an allowlisted record; framework messages and extra fields never reach output. */
export function loggingOptions(
  level: LogLevel,
  root: () => FastifyBaseLogger | undefined,
): LoggerOptions {
  return {
    level,
    base: null,
    formatters: { bindings: () => ({}) },
    hooks: {
      logMethod(arguments_, write) {
        const event = safeEvent(arguments_[0]);
        // Pino child bindings bypass a parent's formatter; the root owns all serialized context.
        if (!event) return;
        const logger = root();
        if (logger) write.call(logger, event);
      },
    },
  };
}

/** Severity is owned by the event contract, not by exception text or caller input. */
export function logEvent(logger: FastifyBaseLogger, event: ServiceEvent): void {
  switch (event.event) {
    case "startup_failed":
    case "shutdown_failed":
    case "upload_failed":
      logger.error(event);
      return;
    case "shutdown_forced":
      logger.warn(event);
      return;
    default:
      logger.info(event);
  }
}

export function requestRoute(route: string | undefined): RequestRoute {
  switch (route) {
    case "/file-upload":
      return "upload";
    case "/health/live":
      return "live";
    case "/health/ready":
      return "ready";
    default:
      return "unmatched";
  }
}

function safeEvent(value: unknown): ServiceEvent | undefined {
  if (!record(value)) return;
  switch (value.event) {
    case "server_started":
      if (integer(value.port, 1, 65_535)) return { event: value.event, port: value.port };
      return;
    case "shutdown_started":
    case "shutdown_forced":
      if (integer(value.activeUploads)) {
        return { event: value.event, activeUploads: value.activeUploads };
      }
      return;
    case "server_stopped":
    case "startup_failed":
    case "shutdown_failed":
      return { event: value.event };
    case "upload_failed":
      if (requestId(value.requestId) && value.category === "processing") {
        return { event: value.event, requestId: value.requestId, category: value.category };
      }
      return;
    case "request_completed":
      if (
        requestId(value.requestId) &&
        (value.route === "upload" ||
          value.route === "live" ||
          value.route === "ready" ||
          value.route === "unmatched") &&
        integer(value.statusCode, 100, 599) &&
        integer(value.elapsedMs)
      ) {
        return {
          event: value.event,
          requestId: value.requestId,
          route: value.route,
          statusCode: value.statusCode,
          elapsedMs: value.elapsedMs,
        };
      }
      return;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function requestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
