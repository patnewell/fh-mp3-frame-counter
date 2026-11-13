import { describe, expect, it, vi } from "vitest";
import { readConfig, resolveAppSettings } from "../../src/config.ts";

describe("runtime configuration", () => {
  it("uses documented defaults without consulting the process environment", () => {
    expect(readConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      maxUploads: 4,
      timeoutMs: 30_000,
      shutdownGraceMs: 10_000,
      logLevel: "info",
    });
    expect(resolveAppSettings().logLevel).toBe("silent");
  });

  it("resolves every supported value and permits an ephemeral server port", () => {
    expect(
      readConfig({
        HOST: "::",
        PORT: "0",
        MAX_UPLOADS: "2",
        REQUEST_TIMEOUT_MS: "1500",
        SHUTDOWN_GRACE_MS: "250",
        LOG_LEVEL: "trace",
      }),
    ).toEqual({
      host: "::",
      port: 0,
      maxUploads: 2,
      timeoutMs: 1500,
      shutdownGraceMs: 250,
      logLevel: "trace",
    });
  });

  it("ignores the removed MAX_FILE_BYTES environment setting", () => {
    expect(readConfig({ MAX_FILE_BYTES: "0" })).toEqual(readConfig({}));
  });

  it.each([
    ["+1", 1],
    ["1e3", 1000],
    [" 3000", 3000],
    ["3000 ", 3000],
  ] as const)("coerces the numeric port %j using normal schema rules", (PORT, port) => {
    expect(readConfig({ PORT }).port).toBe(port);
  });

  it("keeps supplied settings isolated from ambient environment values", () => {
    const runtimeDefaults = readConfig({});
    const appDefaults = resolveAppSettings();
    vi.stubEnv("PORT", "invalid-ambient-port");
    vi.stubEnv("maxUploads", "0");
    try {
      expect(readConfig({})).toEqual(runtimeDefaults);
      expect(resolveAppSettings()).toEqual(appDefaults);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("freezes resolved primitive settings so callers cannot change policy after construction", () => {
    const config = readConfig({ PORT: "65535" });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Reflect.set(config, "port", 1)).toBe(false);
    expect(config.port).toBe(65_535);
    expect(Object.isFrozen(resolveAppSettings())).toBe(true);
  });

  it.each(["", "-1", "1.5", "NaN", "Infinity"])(
    "rejects a port that cannot represent a valid integer: %j",
    (PORT) => {
      expect(() => readConfig({ PORT })).toThrow();
    },
  );

  it.each([
    ["PORT", "65536"],
    ["MAX_UPLOADS", "0"],
    ["MAX_UPLOADS", "9007199254740992"],
    ["MAX_UPLOADS", "Infinity"],
    ["REQUEST_TIMEOUT_MS", "0"],
    ["REQUEST_TIMEOUT_MS", "2147483648"],
    ["REQUEST_TIMEOUT_MS", "Infinity"],
    ["SHUTDOWN_GRACE_MS", "0"],
    ["SHUTDOWN_GRACE_MS", "2147483648"],
    ["SHUTDOWN_GRACE_MS", "Infinity"],
  ])("rejects out-of-range %s", (name, value) => {
    expect(() => readConfig({ [name]: value })).toThrow();
  });

  it("rejects an empty HOST", () => {
    expect(() => readConfig({ HOST: "" })).toThrow();
  });

  it.each(["fatal", "error", "warn", "info", "debug", "trace", "silent"])(
    "accepts log level %s",
    (LOG_LEVEL) => expect(readConfig({ LOG_LEVEL }).logLevel).toBe(LOG_LEVEL),
  );

  it("rejects unsupported logging values", () => {
    expect(() => readConfig({ LOG_LEVEL: "private/secret" })).toThrow();
  });
});
