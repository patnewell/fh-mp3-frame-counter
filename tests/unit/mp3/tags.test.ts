import { describe, expect, it } from "vitest";
import { countFrames } from "../../../src/mp3/count.ts";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { isTagSuffix, MetadataBudget, skipLeadingTags } from "../../../src/mp3/tags.ts";
import { ape, frame, id3, id3v1, withMp3, withReader } from "../../helpers/mp3.ts";

const count = (bytes: Uint8Array) => withMp3(bytes, countFrames);

describe("metadata compatibility", () => {
  it("skips mixed leading envelopes and traverses a complete terminal chain", async () => {
    const leading = Buffer.concat([ape(frame(), true), id3(frame(), 3), id3(frame(), 4, true)]);
    const trailing = Buffer.concat([
      id3(frame(), 4, true),
      ape(frame()),
      ape(frame(), true),
      id3v1(),
    ]);
    expect(await count(Buffer.concat([leading, frame(), trailing]))).toBe(1);
    await withReader(Buffer.concat([leading, frame()]), async (input) => {
      expect(await skipLeadingTags(input)).toBe(leading.length);
    });
  });

  it("accepts terminal APEv1 without claiming to validate metadata items", async () => {
    expect(await count(Buffer.concat([frame(), ape(Buffer.from("item"), false, 1000)]))).toBe(1);
  });

  it("rejects an APEv1 descriptor that claims a version-two header pair", async () => {
    const tag = ape(Buffer.alloc(0), true, 1000);
    await expect(count(Buffer.concat([frame(), tag]))).rejects.toThrow(/APE/);
  });

  it("requires zero APEv1 footer flags under the strict compatibility policy", async () => {
    const tag = ape(Buffer.alloc(0), false, 1000);
    tag.writeUInt32LE(1, 20);
    await expect(count(Buffer.concat([frame(), tag]))).rejects.toThrow(/APE/);
  });

  it("keeps tag signatures inside audio payload and inside larger tags", async () => {
    const audio = frame();
    audio.write("APETAGEX", audio.length - 32);
    audio.write("3DI", audio.length - 10);
    const tag = ape(Buffer.alloc(200));
    tag.write("TAG", tag.length - 128);
    expect(await count(Buffer.concat([audio, tag]))).toBe(1);
  });

  it("tries the valid chain when an ID3v1 payload suggests a competing APE extent", async () => {
    const last = id3v1();
    const decoy = ape();
    decoy.writeUInt32LE(100, 12);
    decoy.copy(last, 96);
    expect(await count(Buffer.concat([frame(), id3v1(), last]))).toBe(1);
  });

  it("does not confuse high-bit payload bytes with literal signatures", async () => {
    const trailing = id3v1();
    trailing.set([0xd4, 0xc1, 0xc7]);
    await expect(count(Buffer.concat([frame(), trailing]))).rejects.toThrow(InvalidMp3Error);
  });

  it("does not impose a recursion or ambiguity limit on 5000 ordinary tags", async () => {
    const tags = Buffer.concat(Array.from({ length: 5000 }, id3v1));
    expect(await count(Buffer.concat([frame(), tags]))).toBe(1);
  });

  it("limits alternative chains rather than allowing adversarial branching", async () => {
    const overlapping = id3v1();
    const decoy = ape();
    decoy.writeUInt32LE(256, 12);
    decoy.copy(overlapping, 96);
    const bytes = Buffer.concat(Array.from({ length: 8198 }, () => overlapping));
    await withReader(bytes, async (input) => {
      await expect(isTagSuffix(input, 0, new MetadataBudget())).rejects.toThrow(
        /alternative metadata chains/,
      );
    });
  });

  it("shares its 4096-alternative allowance across repeated suffix checks", async () => {
    const last = id3v1();
    const decoy = ape();
    decoy.writeUInt32LE(100, 12);
    decoy.copy(last, 96);
    await withReader(Buffer.concat([id3v1(), last]), async (input) => {
      const budget = new MetadataBudget();
      for (let attempt = 0; attempt < 4096; attempt++) {
        expect(await isTagSuffix(input, 0, budget)).toBe(true);
      }
      expect(budget.exhausted).toBe(false);
      await expect(isTagSuffix(input, 0, budget)).rejects.toThrow(/alternative metadata chains/);
      expect(budget.exhausted).toBe(true);
    });
  });

  it("requires every byte of the suffix to belong to its complete tag chain", async () => {
    await withReader(Buffer.concat([frame(), id3v1()]), async (input) => {
      const budget = new MetadataBudget();
      expect(await isTagSuffix(input, 417, budget)).toBe(true);
      expect(await isTagSuffix(input, 0, budget)).toBe(false);
      expect(await isTagSuffix(input, input.size, budget)).toBe(false);
    });
  });

  it.each([
    ["short APE", Buffer.from("APETAGEX")],
    ["footer-only APE", ape()],
    ["leading APEv1", ape(Buffer.alloc(0), true, 1000)],
    ["truncated APE", ape(Buffer.alloc(20), true).subarray(0, 36)],
  ])("rejects a %s leading envelope", async (_name, bytes) => {
    await expect(count(bytes)).rejects.toThrow(/APE/);
  });

  it.each(["size", "version", "flags", "reserved", "pair", "headerFlags"])(
    "rejects an APE %s defect",
    async (defect) => {
      const tag = ape(Buffer.alloc(20), true);
      const footer = tag.length - 32;
      if (defect === "size") tag.writeUInt32LE(31, footer + 12);
      if (defect === "version") tag.writeUInt32LE(3000, footer + 8);
      if (defect === "flags") tag.writeUInt32LE(0xc000_0000, footer + 20);
      if (defect === "reserved") tag[footer + 24] = 1;
      if (defect === "pair") tag.writeUInt32LE(9, 16);
      if (defect === "headerFlags") tag.writeUInt32LE(0x8000_0000, 20);
      await expect(count(Buffer.concat([frame(), tag]))).rejects.toThrow(/APE/);
    },
  );

  it("rejects an APE extent that reaches backward into audio", async () => {
    const tag = ape();
    tag.writeUInt32LE(33, 12);
    await expect(count(Buffer.concat([frame(), tag]))).rejects.toThrow(/APE/);
  });

  it("requires a real matching footer for a leading APE header", async () => {
    const tag = ape(Buffer.alloc(0), true);
    tag.write("WRONGTAG", 32);
    await expect(count(Buffer.concat([tag, frame()]))).rejects.toThrow(/APE/);
  });

  it.each(["missingFlag", "length", "pair", "version"])(
    "rejects an appended ID3 %s defect",
    async (defect) => {
      const tag = id3(Buffer.alloc(12), 4, true);
      const footer = tag.length - 10;
      if (defect === "missingFlag") tag[footer + 5] = 0;
      if (defect === "length") tag[footer + 9] = 100;
      if (defect === "pair") tag[3] = 3;
      if (defect === "version") tag[footer + 3] = 3;
      await expect(count(Buffer.concat([frame(), tag]))).rejects.toThrow(/ID3/);
    },
  );

  it("propagates an abort during terminal metadata traversal", async () => {
    const controller = new AbortController();
    const reason = new Error("Cancel metadata");
    await withReader(
      Buffer.concat([ape(), id3v1()]),
      async (input) => {
        const pending = isTagSuffix(input, 0, new MetadataBudget());
        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
      },
      controller.signal,
    );
  });
});
