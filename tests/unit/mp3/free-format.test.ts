import { describe, expect, it } from "vitest";
import { countFrames } from "../../../src/mp3/count.ts";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { FramingBudget } from "../../../src/mp3/free-format.ts";
import { ape, frame, id3, id3v1, withMp3 } from "../../helpers/mp3.ts";

const count = (bytes: Uint8Array) => withMp3(bytes, countFrames);
const free = (bytes = 500, padding = 0) =>
  frame(padding ? "fffb0200" : "fffb0000", bytes + padding);

describe("free-format compatibility", () => {
  it("resolves two complete frames and varying padding", async () => {
    expect(await count(Buffer.concat([free(), free(500, 1)]))).toBe(2);
    expect(await count(Buffer.concat([free(500, 1), free(), free(500, 1), free()]))).toBe(4);
  });

  it("chooses the earliest complete candidate layout when several counts are possible", async () => {
    // The same 600 bytes admit 100-, 200- and 300-byte frame interpretations.
    expect(await count(Buffer.concat(Array.from({ length: 6 }, () => free(100))))).toBe(6);
  });

  it("retries tempting payload boundaries after their continuation fails", async () => {
    const first = free();
    for (const offset of [100, 200]) Buffer.from("fffb0000", "hex").copy(first, offset);
    expect(await count(Buffer.concat([first, free(), free()]))).toBe(3);
  });

  it("can unwind nested choices beyond an indexed continuation", async () => {
    const first = free();
    for (const offset of [100, 200, 404, 444]) Buffer.from("fffb0000", "hex").copy(first, offset);
    Buffer.from("fffb1000", "hex").copy(first, 300);
    expect(await count(Buffer.concat([first, free(), free()]))).toBe(3);
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

  it("finds a compatible header divided across read windows", async () => {
    expect(await count(Buffer.concat([free(65_570), free(65_570), free(65_570)]))).toBe(3);
  });

  it.each([
    ["one unresolved frame", free()],
    ["truncated final frame", Buffer.concat([free(), free(), free().subarray(0, 499)])],
    ["contradictory final extent", Buffer.concat([free(), free(), free(501)])],
  ])("rejects %s without a partial result", async (_name, bytes) => {
    await expect(count(bytes)).rejects.toThrow(InvalidMp3Error);
  });

  it("bounds traversal of many plausible layouts that all fail near EOF", async () => {
    const bytes = Buffer.alloc(4001);
    for (let offset = 0; offset < 4000; offset += 100)
      Buffer.from("fffb0000", "hex").copy(bytes, offset);
    await expect(count(bytes)).rejects.toThrow(/work budget/);
  });

  it("does not bypass metadata exhaustion by retrying a later valid frame length", async () => {
    const bytes = Buffer.concat([free(1_100_000), free(1_100_000)]);
    Buffer.from("fffb0000", "hex").copy(bytes, 100);
    const overlapping = id3v1();
    const decoy = ape();
    decoy.writeUInt32LE(256, 12);
    decoy.copy(overlapping, 96);
    for (let offset = bytes.length - 8198 * 128; offset < bytes.length; offset += 128) {
      overlapping.copy(bytes, offset);
    }
    await expect(count(bytes)).rejects.toThrow(/alternative metadata chains/);
  });

  it("accepts 4096 inferred runs and rejects the next candidate", async () => {
    const run = Buffer.concat([
      frame("fffb00c0", 21),
      frame("fffb00c0", 21),
      frame("fffb1000", 104),
    ]);
    const bytes = Buffer.concat(Array.from({ length: 4097 }, () => run));
    expect(await count(bytes.subarray(0, bytes.length - run.length))).toBe(12_288);
    await expect(count(bytes)).rejects.toThrow(/candidate budget/);
  });

  it("propagates cancellation instead of trying another interpretation", async () => {
    const controller = new AbortController();
    const reason = new Error("Stop candidate search");
    await withMp3(Buffer.concat([free(), free(), free()]), async (path) => {
      const pending = countFrames(path, controller.signal);
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    });
  });

  it("permits exactly eight file lengths of charged framing work", () => {
    const budget = new FramingBudget(100);
    budget.visit(800);
    expect(budget.exhausted).toBe(false);
    expect(() => budget.visit(1)).toThrow(/work budget/);
    expect(budget.exhausted).toBe(true);
  });
});
