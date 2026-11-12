import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countFrames } from "../../src/mp3/count.ts";
import { InvalidMp3Error } from "../../src/mp3/error.ts";
import manifest from "../fixtures/manifest.json" with { type: "json" };

describe("independently established MP3 fixtures", () => {
  it.each(manifest.fixtures)("preserves and counts $file", async (fixture) => {
    const path = fileURLToPath(new URL(`../fixtures/${fixture.file}`, import.meta.url));
    const bytes = await readFile(path);
    expect(bytes.length).toBe(fixture.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
    if (fixture.expectedFrames === null) {
      await expect(countFrames(createReadStream(path))).rejects.toThrow(InvalidMp3Error);
    } else {
      expect(await countFrames(createReadStream(path))).toBe(fixture.expectedFrames);
    }
  });

  it("counts over 64 MiB of real audio generated lazily without a file or complete buffer", async () => {
    const block = await readFile(new URL("../fixtures/cbr-stereo-44100.mp3", import.meta.url));
    let generated = 0;
    async function* source() {
      for (let repetition = 0; repetition < 8192; repetition++) {
        generated += block.length;
        yield block;
      }
    }
    // 8192 repetitions × independently established 21 frames per frame-only block.
    expect(await countFrames(source())).toBe(172_032);
    expect(generated).toBe(71_901_184);
  });
});
