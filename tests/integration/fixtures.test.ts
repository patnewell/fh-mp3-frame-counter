import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countFrames } from "../../src/mp3/count.ts";
import { InvalidMp3Error } from "../../src/mp3/error.ts";
import manifest from "../fixtures/manifest.json" with { type: "json" };
import { withMp3 } from "../helpers/mp3.ts";

describe("independently established MP3 fixtures", () => {
  it.each(manifest.fixtures)("preserves and counts $file", async (fixture) => {
    const path = fileURLToPath(new URL(`../fixtures/${fixture.file}`, import.meta.url));
    const bytes = await readFile(path);
    expect(bytes.length).toBe(fixture.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
    if (fixture.expectedFrames === null) {
      await expect(countFrames(path)).rejects.toThrow(InvalidMp3Error);
    } else {
      expect(await countFrames(path)).toBe(fixture.expectedFrames);
    }
  });

  it("counts a real-audio file larger than 64 MiB, written in bounded blocks", async () => {
    const block = await readFile(new URL("../fixtures/cbr-stereo-44100.mp3", import.meta.url));
    await withMp3(new Uint8Array(), async (path) => {
      const output = await open(path, "w");
      try {
        for (let repetition = 0; repetition < 8192; repetition++) await output.writeFile(block);
        expect((await output.stat()).size).toBe(71_901_184);
      } finally {
        await output.close();
      }
      expect(await countFrames(path)).toBe(172_032);
    });
  });
});
