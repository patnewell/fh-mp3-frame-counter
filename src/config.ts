import envSchema, { type JSONSchemaType } from "env-schema";
import type { LogLevel } from "fastify";

export type { LogLevel } from "fastify";

export interface AppSettings {
  readonly maxUploads: number;
  readonly timeoutMs: number;
  readonly logLevel: LogLevel;
}

export type AppOptions = Partial<AppSettings>;

export interface RuntimeConfig extends AppSettings {
  readonly host: string;
  readonly port: number;
  readonly shutdownGraceMs: number;
}

// Recheck coerced integers to reject Infinity until ajv-validator/ajv#2626 is fixed.
const integer = { type: "integer", allOf: [{ type: "integer" }] } as const;

const appSchema = {
  type: "object",
  required: ["maxUploads", "timeoutMs", "logLevel"],
  properties: {
    maxUploads: { ...integer, minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 4 },
    timeoutMs: { ...integer, minimum: 1, maximum: 2_147_483_647, default: 30_000 },
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
    logLevel: { ...appSchema.properties.logLevel, default: "info" },
    host: { type: "string", minLength: 1, default: "127.0.0.1" },
    port: { ...integer, minimum: 0, maximum: 65_535, default: 3000 },
    shutdownGraceMs: { ...integer, minimum: 1, maximum: 2_147_483_647, default: 10_000 },
  },
} satisfies JSONSchemaType<RuntimeConfig>;

export function resolveAppSettings(options: AppOptions = {}): AppSettings {
  return Object.freeze(envSchema<AppSettings>({ schema: appSchema, data: options, env: false }));
}

/** Explicit data keeps application construction independent of the ambient environment. */
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
