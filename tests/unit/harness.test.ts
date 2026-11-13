import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { within } from "../helpers/async.ts";

const root = new URL("../../", import.meta.url);

describe("repository guardrails", () => {
  it("lets the memory preload exit without an application or referenced IPC handle", async () => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        new URL("scripts/resource-monitor.ts", root).href,
        "--input-type=module",
        "--eval",
        "",
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
    );
    let stderr = "";
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );
    try {
      const result = await within(closed);
      expect(result).toEqual({ code: 0, signal: null });
      expect(stderr).toBe("");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await within(closed);
    }
  });

  it.each([
    ["independent parser", "export const parse = (word: number): number => word;", true],
    ["framework", 'export { default as dependency } from "fastify";', false],
    ["filesystem", 'export { readFile as dependency } from "node:fs/promises";', false],
    ["upload policy", 'export { value } from "../upload/admission.ts";', false],
    ["application", 'export { value } from "../app.js";', false],
    ["configuration", 'export { value } from "../config.ts";', false],
    ["operational logging", 'export { value } from "../logging.ts";', false],
    ["health executable", 'export { value } from "../healthcheck.js";', false],
  ] as const)("checks the actual import policy: %s", async (_name, source, allowed) => {
    const directory = await mkdtemp(join(tmpdir(), "mp3-policy-"));
    try {
      await mkdir(join(directory, "src", "mp3"), { recursive: true });
      await writeFile(join(directory, "biome.json"), await readFile(new URL("biome.json", root)));
      const probe = join(directory, "src", "mp3", "probe.ts");
      await writeFile(probe, source);
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("node_modules/@biomejs/biome/bin/biome", root)),
          "lint",
          "--vcs-enabled=false",
          "--config-path",
          directory,
          probe,
        ],
        // A synchronous child blocks Vitest's own timeout, so bound it at the process boundary.
        { cwd: directory, encoding: "utf8", timeout: 5000, windowsHide: true },
      );
      expect(result.error).toBeUndefined();
      expect(result.status === 0).toBe(allowed);
      if (!allowed) expect(result.stdout + result.stderr).toContain("noRestrictedImports");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves the pinned upstream Lean skills", async () => {
    const provenance = JSON.parse(
      await readFile(new URL("docs/spec-kit/provenance.json", root), "utf8"),
    ) as { sha256: Record<string, string> };
    expect(Object.keys(provenance.sha256)).toHaveLength(5);
    for (const [path, expected] of Object.entries(provenance.sha256)) {
      const actual = createHash("sha256")
        .update(await readFile(new URL(path, root)))
        .digest("hex");
      expect(actual, path).toBe(expected);
    }
  });
});
