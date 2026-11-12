import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

describe("repository guardrails", () => {
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
        { cwd: directory, encoding: "utf8" },
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
