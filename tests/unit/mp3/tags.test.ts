import { describe, expect, it } from "vitest";
import { countFrames } from "../../../src/mp3/count.ts";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { ape, chunkBytes, frame, id3, id3v1 } from "../../helpers/mp3.ts";

const count = (bytes: Uint8Array) => countFrames(chunkBytes(bytes));

function ambiguousUnknownSuffix(): Buffer {
  const tag = id3v1();
  const decoy = ape();
  decoy.writeUInt32LE(256, 12);
  decoy.copy(tag, 96);
  // The leading junk defeats every complete chain; each TAG also offers a two-tag APE extent.
  const suffix = Buffer.alloc(1 + 511 * 128);
  suffix[0] = 1;
  for (let offset = 1; offset < suffix.length; offset += tag.length) tag.copy(suffix, offset);
  return suffix;
}

describe("incremental metadata compatibility", () => {
  it("skips mixed leading envelopes and traverses a complete terminal chain", async () => {
    const leading = Buffer.concat([ape(frame(), true), id3(frame(), 3), id3(frame(), 4, true)]);
    const trailing = Buffer.concat([
      id3(frame(), 4, true),
      ape(frame()),
      ape(frame(), true),
      id3v1(),
    ]);
    const bytes = Buffer.concat([leading, frame(), trailing]);
    expect(await count(bytes)).toBe(1);
    expect(await countFrames(chunkBytes(bytes, [1]))).toBe(1);
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

  it("prefers the forward ID3v1 envelope over an APE lookalike inside its payload", async () => {
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
    async function* source() {
      yield frame();
      for (let repetition = 0; repetition < 5000; repetition++) yield id3v1();
    }
    expect(await countFrames(source())).toBe(1);
  });

  it("accepts forward TAG chains without charging APE payload lookalikes as alternatives", async () => {
    // 002 speculated backward over these descriptors; 005 commits recognized forward tags.
    const overlapping = id3v1();
    const decoy = ape();
    decoy.writeUInt32LE(256, 12);
    decoy.copy(overlapping, 96);
    async function* source() {
      yield frame();
      for (let repetition = 0; repetition < 8198; repetition++) yield overlapping;
    }
    expect(await countFrames(source())).toBe(1);
  });

  it("accepts exactly 64 KiB of undeclared footer-only APE metadata", async () => {
    const suffix = ape(Buffer.alloc(65_536 - 32, 0x55));
    expect(await countFrames(chunkBytes(Buffer.concat([frame(), suffix]), [3, 29, 1024]))).toBe(1);
  });

  it("rejects an undeclared terminal suffix beyond 64 KiB instead of retaining it", async () => {
    const suffix = ape(Buffer.alloc(65_537 - 32, 0x55));
    await expect(count(Buffer.concat([frame(), suffix]))).rejects.toThrow(InvalidMp3Error);
  });

  it("bounds alternative chains within the unknown suffix allowance", async () => {
    const suffix = ambiguousUnknownSuffix();
    expect(suffix.length).toBe(65_409);
    await expect(count(Buffer.concat([frame(), suffix]))).rejects.toThrow(
      /alternative metadata chains/,
    );
  });

  it("allows event-loop cancellation during bounded suffix validation after EOF", async () => {
    const controller = new AbortController();
    const reason = new Error("Cancel terminal alternatives");
    let cancellation: NodeJS.Immediate | undefined;
    async function* source() {
      yield frame();
      yield ambiguousUnknownSuffix();
      // Schedule only when EOF is requested, after the byte-consumption phase has finished.
      cancellation = setImmediate(() => controller.abort(reason));
    }
    try {
      await expect(countFrames(source(), controller.signal)).rejects.toBe(reason);
    } finally {
      clearImmediate(cancellation);
    }
  });

  it.each([1, 4, 32])(
    "owns metadata descriptors when a producer reuses %i-byte chunks",
    async (size) => {
      const bytes = Buffer.concat([
        id3(Buffer.alloc(513, 0x55), 4, true),
        ape(Buffer.alloc(519, 0x55), true),
        frame(),
        id3(Buffer.alloc(513, 0x55), 4, true),
        ape(Buffer.alloc(519, 0x55), true),
      ]);
      async function* reused() {
        const scratch = Buffer.alloc(size);
        for (let offset = 0; offset < bytes.length; offset += size) {
          const length = Math.min(size, bytes.length - offset);
          bytes.copy(scratch, 0, offset, offset + length);
          yield scratch.subarray(0, length);
        }
      }
      expect(await countFrames(reused())).toBe(1);
    },
  );

  it("requires every byte of a terminal suffix to be valid metadata", async () => {
    await expect(
      count(Buffer.concat([frame(), ape(Buffer.alloc(17)), Buffer.of(1)])),
    ).rejects.toThrow(InvalidMp3Error);
    await expect(count(Buffer.concat([frame(), id3v1(), frame()]))).rejects.toThrow(
      InvalidMp3Error,
    );
  });

  it.each([
    ["ID3v1", id3v1()],
    ["paired ID3v2.4", id3(Buffer.from("title"), 4, true)],
    ["paired APEv2", ape(Buffer.from("title"), true)],
  ])("rejects resumed audio after terminal %s even in one-byte chunks", async (_name, tag) => {
    const bytes = Buffer.concat([frame(), tag, frame()]);
    await expect(count(bytes)).rejects.toThrow(InvalidMp3Error);
    await expect(countFrames(chunkBytes(bytes, [1]))).rejects.toThrow(InvalidMp3Error);
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
    async function* source() {
      yield frame();
      yield ape();
      controller.abort(reason);
      yield id3v1();
    }
    await expect(countFrames(source(), controller.signal)).rejects.toBe(reason);
  });

  it.each(["leading ID3", "trailing ID3", "leading APE", "trailing APE"])(
    "skips a large declared %s body lazily without applying the unknown-suffix allowance",
    async (kind) => {
      const size = 8 * 1024 * 1024;
      const payload = Buffer.alloc(64 * 1024, 0x55);
      let header: Buffer;
      let footer: Buffer;
      if (kind.endsWith("ID3")) {
        header = id3(Buffer.alloc(0), 4, true).subarray(0, 10);
        for (let index = 0; index < 4; index++) header[9 - index] = (size >>> (7 * index)) & 127;
        footer = Buffer.from(header);
        footer.write("3DI");
      } else {
        header = ape(Buffer.alloc(0), true).subarray(0, 32);
        header.writeUInt32LE(size + 32, 12);
        footer = Buffer.from(header);
        footer.writeUInt32LE(0x8000_0000, 20);
      }
      async function* source() {
        if (kind.startsWith("trailing")) yield frame();
        yield header;
        for (let offset = 0; offset < size; offset += payload.length) yield payload;
        yield footer;
        if (kind.startsWith("leading")) yield frame();
      }
      expect(await countFrames(source())).toBe(1);
    },
  );
});
