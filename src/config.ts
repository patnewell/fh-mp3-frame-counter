import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof logLevels)[number];

export interface AppOptions {
  readonly tempDirectory?: string;
  readonly maxFileBytes?: number;
  readonly maxUploads?: number;
  readonly timeoutMs?: number;
  readonly logLevel?: LogLevel;
}

export interface AppSettings {
  readonly tempDirectory: string;
  readonly maxFileBytes: number;
  readonly maxUploads: number;
  readonly timeoutMs: number;
  readonly logLevel: LogLevel;
}

export interface RuntimeConfig extends AppSettings {
  readonly host: string;
  readonly port: number;
  readonly shutdownGraceMs: number;
}

/** Programmatic and environment configuration share the same range and path policy. */
export function resolveAppSettings(options: AppOptions = {}): AppSettings {
  const tempDirectory = options.tempDirectory ?? tmpdir();
  if (!isAbsolute(tempDirectory) || tempDirectory.includes("\0")) {
    throw new Error("UPLOAD_TEMP_DIR must be an absolute directory path without NUL bytes.");
  }
  return Object.freeze({
    tempDirectory,
    maxFileBytes: integer(options.maxFileBytes ?? 100 * 1024 * 1024, "MAX_FILE_BYTES"),
    maxUploads: integer(options.maxUploads ?? 4, "MAX_UPLOADS"),
    timeoutMs: integer(options.timeoutMs ?? 30_000, "REQUEST_TIMEOUT_MS", 1, 2_147_483_647),
    logLevel: logLevel(options.logLevel ?? "silent"),
  });
}

/** Only process entrypoints supply environment values; no supplied value enters an error message. */
export function readConfig(environment: Readonly<NodeJS.ProcessEnv>): RuntimeConfig {
  const defaults = resolveAppSettings();
  const host = environment.HOST ?? "127.0.0.1";
  if (!host.trim() || host.includes("\0")) {
    throw new Error("HOST must be nonblank and contain no NUL bytes.");
  }
  return Object.freeze({
    ...resolveAppSettings({
      tempDirectory: environment.UPLOAD_TEMP_DIR ?? defaults.tempDirectory,
      maxFileBytes: decimal(environment.MAX_FILE_BYTES, "MAX_FILE_BYTES", defaults.maxFileBytes),
      maxUploads: decimal(environment.MAX_UPLOADS, "MAX_UPLOADS", defaults.maxUploads),
      timeoutMs: decimal(environment.REQUEST_TIMEOUT_MS, "REQUEST_TIMEOUT_MS", defaults.timeoutMs),
      logLevel: logLevel(environment.LOG_LEVEL ?? "info"),
    }),
    host,
    port: integer(decimal(environment.PORT, "PORT", 3000), "PORT", 0, 65_535),
    shutdownGraceMs: integer(
      decimal(environment.SHUTDOWN_GRACE_MS, "SHUTDOWN_GRACE_MS", 10_000),
      "SHUTDOWN_GRACE_MS",
      1,
      2_147_483_647,
    ),
  });
}

function decimal(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new RangeError(`${name} must be a decimal integer.`);
  return Number(value);
}

function integer(
  value: number,
  name: string,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function logLevel(value: string): LogLevel {
  const level = logLevels.find((candidate) => candidate === value);
  if (level === undefined) throw new Error("LOG_LEVEL must be a supported logging level.");
  return level;
}
