import { describe, expect, it } from "vitest";
import { readConfig, resolveAppSettings } from "../../src/config.ts";

describe("runtime configuration", () => {
  it("uses documented defaults without consulting the process environment", () => {
    expect(readConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      maxFileBytes: 100 * 1024 * 1024,
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
        MAX_FILE_BYTES: "4096",
        MAX_UPLOADS: "2",
        REQUEST_TIMEOUT_MS: "1500",
        SHUTDOWN_GRACE_MS: "250",
        LOG_LEVEL: "trace",
      }),
    ).toEqual({
      host: "::",
      port: 0,
      maxFileBytes: 4096,
      maxUploads: 2,
      timeoutMs: 1500,
      shutdownGraceMs: 250,
      logLevel: "trace",
    });
  });

  it("freezes resolved primitive settings so callers cannot change policy after construction", () => {
    const config = readConfig({ PORT: "65535" });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Reflect.set(config, "port", 1)).toBe(false);
    expect(config.port).toBe(65_535);
    expect(Object.isFrozen(resolveAppSettings())).toBe(true);
  });

  it.each(["", "-1", "+1", "1.5", "1e3", " 3000", "3000 ", "NaN", "Infinity"])(
    "rejects a non-decimal port %j without reflecting it",
    (PORT) => {
      expect(() => readConfig({ PORT })).toThrow("PORT must be a decimal integer.");
    },
  );

  it.each([
    ["PORT", "65536"],
    ["MAX_FILE_BYTES", "0"],
    ["MAX_FILE_BYTES", "9007199254740992"],
    ["MAX_UPLOADS", "0"],
    ["MAX_UPLOADS", "9007199254740992"],
    ["REQUEST_TIMEOUT_MS", "0"],
    ["REQUEST_TIMEOUT_MS", "2147483648"],
    ["SHUTDOWN_GRACE_MS", "0"],
    ["SHUTDOWN_GRACE_MS", "2147483648"],
  ])("rejects out-of-range %s", (name, value) => {
    expect(() => readConfig({ [name]: value })).toThrow(RangeError);
  });

  it.each(["", "  ", "localhost\0private"])("rejects an unusable HOST %j", (HOST) => {
    expect(() => readConfig({ HOST })).toThrow("HOST must be nonblank and contain no NUL bytes.");
  });

  it.each(["fatal", "error", "warn", "info", "debug", "trace", "silent"])(
    "accepts log level %s",
    (LOG_LEVEL) => expect(readConfig({ LOG_LEVEL }).logLevel).toBe(LOG_LEVEL),
  );

  it("rejects unknown logging values without including supplied text", () => {
    expect(() => readConfig({ LOG_LEVEL: "private/secret" })).toThrow(
      "LOG_LEVEL must be a supported logging level.",
    );
  });
});
