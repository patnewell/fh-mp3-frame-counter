import { describe, expect, it } from "vitest";
import { countFrames } from "../../../src/mp3/count.ts";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { ape, chunkBytes, frame, id3, id3v1 } from "../../helpers/mp3.ts";

const count = (bytes: Uint8Array) => countFrames(chunkBytes(bytes));
const free = (bytes = 500, padding = 0) =>
  frame(padding ? "fffb0200" : "fffb0000", bytes + padding);

describe("free-format compatibility", () => {
  it("resolves two complete frames and varying padding", async () => {
    expect(await count(Buffer.concat([free(), free(500, 1)]))).toBe(2);
    expect(await count(Buffer.concat([free(500, 1), free(), free(500, 1), free()]))).toBe(4);
  });

  it("commits the earliest compatible boundary when several layouts are possible", async () => {
    // The same 600 bytes admit 100-, 200- and 300-byte frame interpretations.
    expect(await count(Buffer.concat(Array.from({ length: 6 }, () => free(100))))).toBe(6);
  });

  it("rejects a later contradiction after committing a tempting payload boundary", async () => {
    const first = free();
    for (const offset of [100, 200]) Buffer.from("fffb0000", "hex").copy(first, offset);
    // 005 deliberately replaces the old successful full-suffix retry with a local commitment.
    await expect(count(Buffer.concat([first, free(), free()]))).rejects.toThrow(InvalidMp3Error);
  });

  it("does not rewind a committed choice across an indexed continuation", async () => {
    const first = free();
    for (const offset of [100, 200, 404, 444]) Buffer.from("fffb0000", "hex").copy(first, offset);
    Buffer.from("fffb1000", "hex").copy(first, 300);
    await expect(count(Buffer.concat([first, free(), free()]))).rejects.toThrow(InvalidMp3Error);
  });

  it("establishes a new length after indexed frames or a rate change", async () => {
    const secondRate = frame("fffb0400", 600);
    expect(await count(Buffer.concat([free(), free(), secondRate, secondRate]))).toBe(4);
    expect(await count(Buffer.concat([free(), free(), frame(), secondRate, secondRate]))).toBe(5);
  });

  it("requires the inferred length to fit framing overhead", async () => {
    const mono = frame("fffb00c0", 21);
    const stereo = frame("fffb0000", 21);
    expect(await count(Buffer.concat([mono, mono]))).toBe(2);
    await expect(count(Buffer.concat([mono, stereo]))).rejects.toThrow(InvalidMp3Error);
  });

  it.each([
    ["ID3v1", id3v1()],
    ["APE", ape()],
    ["ID3v2.4", id3(Buffer.from("title"), 4, true)],
  ])("validates a %s suffix after inferred frames", async (_name, suffix) => {
    expect(await count(Buffer.concat([free(), free(), suffix]))).toBe(2);
  });

  it.each([
    ["TAG", 128],
    ["APETAGEX", 32],
    ["3DI", 10],
  ])("keeps %s-shaped bytes inside short frame payloads", async (text, distance) => {
    const bytes = Buffer.concat([free(100), free(100)]);
    bytes.write(text, bytes.length - distance);
    expect(await count(bytes)).toBe(2);
    expect(await count(Buffer.concat([bytes, id3v1()]))).toBe(2);
  });

  it("finds a compatible header divided across producer chunks", async () => {
    const bytes = Buffer.concat([free(65_570), free(65_570), free(65_570)]);
    expect(await countFrames(chunkBytes(bytes, [65_571, 2, 17]))).toBe(3);
  });

  it.each([
    ["one unresolved frame", free()],
    ["truncated final frame", Buffer.concat([free(), free(), free().subarray(0, 499)])],
    ["contradictory final extent", Buffer.concat([free(), free(), free(501)])],
  ])("rejects %s without a partial result", async (_name, bytes) => {
    await expect(count(bytes)).rejects.toThrow(InvalidMp3Error);
  });

  it("rejects a contradictory committed layout without an EOF-sized retry search", async () => {
    const bytes = Buffer.alloc(4001);
    for (let offset = 0; offset < 4000; offset += 100)
      Buffer.from("fffb0000", "hex").copy(bytes, offset);
    await expect(count(bytes)).rejects.toThrow(InvalidMp3Error);
  });

  it("rejects the formerly seekable 1.1 MiB free-frame layout at the inference bound", async () => {
    // 002 reached metadata ambiguity on this size; 005 rejects before retaining/reading that extent.
    const bytes = Buffer.concat([free(1_100_000), free(1_100_000)]);
    await expect(count(bytes)).rejects.toThrow(/distance|length|limit|bound/);
  });

  it("accepts 4096 inferred runs and rejects the next candidate", async () => {
    const run = Buffer.concat([
      frame("fffb00c0", 21),
      frame("fffb00c0", 21),
      frame("fffb1000", 104),
    ]);
    const bytes = Buffer.concat(Array.from({ length: 4097 }, () => run));
    expect(await count(bytes.subarray(0, bytes.length - run.length))).toBe(12_288);
    await expect(count(bytes)).rejects.toThrow(/candidate|inference|run/);
  });

  it("propagates cancellation instead of trying another interpretation", async () => {
    const controller = new AbortController();
    const reason = new Error("Stop candidate search");
    const pending = countFrames(
      chunkBytes(Buffer.concat([free(), free(), free()])),
      controller.signal,
    );
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("accepts the 128 KiB unpadded inference distance including first-frame padding", async () => {
    expect(await count(Buffer.concat([free(128 * 1024, 1), free(128 * 1024)]))).toBe(2);
  });

  it("rejects a compatible boundary beyond the 128 KiB distance allowance", async () => {
    await expect(
      count(Buffer.concat([free(128 * 1024 + 1), free(128 * 1024 + 1)])),
    ).rejects.toThrow(InvalidMp3Error);
  });

  it("bounds total inference scanning independently of final stream length", async () => {
    const run = Buffer.concat([free(128 * 1024), free(128 * 1024), frame()]);
    async function* repeated(runs: number) {
      for (let index = 0; index < runs; index++) yield run;
    }
    expect(await countFrames(repeated(128))).toBe(384);
    await expect(countFrames(repeated(129))).rejects.toThrow(/search|work|budget/);
  });
});
