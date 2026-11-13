import envSchema, { type JSONSchemaType } from "env-schema";
import type { LogLevel } from "fastify";

export type { LogLevel } from "fastify";

/** Validated, immutable policy for one application instance. */
export interface AppSettings {
  /** Maximum concurrent uploads; capacity stays occupied until owned work settles. */
  readonly maxUploads: number;
  /** Upload deadline in milliseconds, measured from admission through processing. */
  readonly timeoutMs: number;
  /** Fastify logging level; programmatic applications default to silent. */
  readonly logLevel: LogLevel;
}

/** Optional overrides for application construction; omitted values use schema defaults. */
export type AppOptions = Partial<AppSettings>;

/** Application policy plus listener and shutdown settings resolved at startup. */
export interface RuntimeConfig extends AppSettings {
  /** Nonempty listening address; the listener validates and resolves the host. */
  readonly host: string;
  /** TCP port; zero requests an ephemeral port and cannot be used by the healthcheck. */
  readonly port: number;
  /** Milliseconds to drain before active connections are forcibly closed. */
  readonly shutdownGraceMs: number;
}

// Node timers overflow above a signed 32-bit delay and would fire almost immediately.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// Recheck after coercion: Ajv can otherwise accept "Infinity" despite integer bounds
// (ajv-validator/ajv#2626). Keep this guard shared by all integer settings.
const integerSchema = { type: "integer", allOf: [{ type: "integer" }] } as const;

// env-schema fills defaults before validating required properties and coerces numeric
// strings using its standard rules. `satisfies` checks schema types without widening them.
const appSchema = {
  type: "object",
  required: ["maxUploads", "timeoutMs", "logLevel"],
  properties: {
    maxUploads: { ...integerSchema, minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 4 },
    timeoutMs: { ...integerSchema, minimum: 1, maximum: MAX_TIMER_DELAY_MS, default: 30_000 },
    logLevel: {
      type: "string",
      enum: ["fatal", "error", "warn", "info", "debug", "trace", "silent"] satisfies LogLevel[],
      default: "silent",
    },
  },
} satisfies JSONSchemaType<AppSettings>;

const runtimeSchema = {
  type: "object",
  required: [...appSchema.required, "host", "port", "shutdownGraceMs"],
  properties: {
    ...appSchema.properties,
    // The executable logs at info by default; embedded applications remain silent.
    logLevel: { ...appSchema.properties.logLevel, default: "info" },
    host: { type: "string", minLength: 1, default: "127.0.0.1" },
    port: { ...integerSchema, minimum: 0, maximum: 65_535, default: 3000 },
    shutdownGraceMs: { ...integerSchema, minimum: 1, maximum: MAX_TIMER_DELAY_MS, default: 10_000 },
  },
} satisfies JSONSchemaType<RuntimeConfig>;

/**
 * Resolve explicit application overrides without reading process.env or loading .env.
 * Returns a frozen snapshot; the caller's options are not modified.
 * @throws An env-schema validation error when supplied values violate the schema.
 */
export function resolveAppSettings(options: AppOptions = {}): AppSettings {
  return Object.freeze(envSchema<AppSettings>({ schema: appSchema, data: options, env: false }));
}

/**
 * Map supported environment variables to a frozen runtime configuration.
 * Only the supplied environment is read; env: false prevents ambient process.env merging,
 * and env-schema leaves .env loading disabled by default. Validation uses standard coercion.
 * @throws An env-schema validation error when supplied values violate the schema.
 */
export function readConfig(environment: Readonly<NodeJS.ProcessEnv>): RuntimeConfig {
  return Object.freeze(
    envSchema<RuntimeConfig>({
      schema: runtimeSchema,
      env: false,
      data: {
        host: environment.HOST,
        port: environment.PORT,
        maxUploads: environment.MAX_UPLOADS,
        timeoutMs: environment.REQUEST_TIMEOUT_MS,
        shutdownGraceMs: environment.SHUTDOWN_GRACE_MS,
        logLevel: environment.LOG_LEVEL,
      },
    }),
  );
}
