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
  it.each([2, 3, 4])(
    "ignores ID3v2.%i revision and flags unrelated to its extent",
    async (version) => {
      const tag = id3(frame(), version);
      tag[4] = 255;
      // The footer bit is meaningful only in v2.4; other flag bits do not change size.
      tag[5] = version === 4 ? 0xef : 0xff;
      const bytes = Buffer.concat([tag, frame(), tag]);
      expect(await countFrames(chunkBytes(bytes, [1, 7, 32]))).toBe(1);
    },
  );

  it.each(["ID3", "APE"])(
    "uses the leading %s descriptor's extent despite a contradictory footer",
    async (kind) => {
      const tag = kind === "ID3" ? id3(frame(), 4, true) : ape(frame(), true);
      const footerBytes = kind === "ID3" ? 10 : 32;
      // Even a footer containing a frame header belongs to the declared metadata.
      tag.fill(0xff, tag.length - footerBytes);
      Buffer.from("fffb9000", "hex").copy(tag, tag.length - footerBytes);
      const bytes = Buffer.concat([tag, frame(), tag]);
      expect(await count(bytes)).toBe(1);
      expect(await countFrames(chunkBytes(bytes, [1]))).toBe(1);
    },
  );

  it.each([false, true])(
    "ignores APE reserved bytes and unrelated flags (paired: %s)",
    async (paired) => {
      const tag = ape(Buffer.concat([Buffer.from("title"), frame()]), paired);
      const footer = tag.length - 32;
      tag.writeUInt32LE((paired ? 0x8000_0000 : 0) + 0x101, footer + 20);
      tag.fill(0xa5, footer + 24);
      if (paired) {
        tag.writeUInt32LE(123, 16); // Item counts are not used to locate audio.
        tag.writeUInt32LE(0xa000_0101, 20);
        tag.fill(0x5a, 24, 32);
      }
      expect(await countFrames(chunkBytes(Buffer.concat([frame(), tag]), [3, 29, 17]))).toBe(1);
    },
  );

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

  it("treats APEv1 descriptors as footer-only extents regardless of version-two flag bits", async () => {
    const tag = ape(Buffer.alloc(0), true, 1000);
    expect(await count(Buffer.concat([frame(), tag]))).toBe(1);
  });

  it("ignores APEv1 footer flags when counting frames", async () => {
    const tag = ape(Buffer.alloc(0), false, 1000);
    tag.writeUInt32LE(1, 20);
    expect(await count(Buffer.concat([frame(), tag]))).toBe(1);
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

  it("requires metadata extents to account for every byte of a terminal suffix", async () => {
    await expect(
      count(Buffer.concat([frame(), ape(Buffer.alloc(17)), Buffer.of(1)])),
    ).rejects.toThrow(InvalidMp3Error);
    await expect(count(Buffer.concat([frame(), id3v1(), frame()]))).rejects.toThrow(
      InvalidMp3Error,
    );
  });

  it.each([
    ["ID3v1", id3v1()],
    ["ID3v2.3", id3(Buffer.from("title"), 3)],
    ["ID3v2.4 without footer", id3(Buffer.from("title"))],
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

  it.each(["size", "version", "flags", "reserved", "pair"])(
    "counts despite an APE %s defect that does not change its forward extent",
    async (defect) => {
      const tag = ape(Buffer.alloc(20), true);
      const footer = tag.length - 32;
      if (defect === "size") tag.writeUInt32LE(31, footer + 12);
      if (defect === "version") tag.writeUInt32LE(3000, footer + 8);
      if (defect === "flags") tag.writeUInt32LE(0xc000_0000, footer + 20);
      if (defect === "reserved") tag[footer + 24] = 1;
      if (defect === "pair") tag.writeUInt32LE(9, 16);
      expect(await count(Buffer.concat([frame(), tag]))).toBe(1);
    },
  );

  it("uses the APE footer's extent after audio when header role bits are damaged", async () => {
    const tag = ape(Buffer.alloc(20), true);
    tag.writeUInt32LE(0x8000_0000, 20);
    expect(await count(Buffer.concat([frame(), tag]))).toBe(1);
  });

  it("rejects an APE extent that reaches backward into audio", async () => {
    const tag = ape();
    tag.writeUInt32LE(33, 12);
    await expect(count(Buffer.concat([frame(), tag]))).rejects.toThrow(InvalidMp3Error);
  });

  it("skips a damaged APE footer using the leading header's extent", async () => {
    const tag = ape(Buffer.alloc(0), true);
    tag.write("WRONGTAG", 32);
    expect(await count(Buffer.concat([tag, frame()]))).toBe(1);
  });

  it.each(["missingFlag", "length", "version"])(
    "ignores an appended ID3 footer %s defect when the header supplies its extent",
    async (defect) => {
      const tag = id3(Buffer.alloc(12), 4, true);
      const footer = tag.length - 10;
      if (defect === "missingFlag") tag[footer + 5] = 0;
      if (defect === "length") tag[footer + 9] = 100;
      if (defect === "version") tag[footer + 3] = 3;
      expect(await count(Buffer.concat([frame(), tag]))).toBe(1);
    },
  );

  it("does not interpret a reserved ID3v2.3 flag as an extra footer", async () => {
    const tag = id3(Buffer.alloc(12), 4, true);
    tag[3] = 3;
    // v2.3's header owns only its payload. These undeclared trailing bytes have
    // no complete metadata layout and must not be silently ignored.
    await expect(count(Buffer.concat([frame(), tag]))).rejects.toThrow(InvalidMp3Error);
  });

  it.each(["size", "version", "role"])(
    "rejects an unusable leading APE %s field",
    async (defect) => {
      const tag = ape(Buffer.alloc(20), true);
      if (defect === "size") tag.writeUInt32LE(31, 12);
      if (defect === "version") tag.writeUInt32LE(3000, 8);
      if (defect === "role") tag.writeUInt32LE(0x8000_0000, 20);
      await expect(count(Buffer.concat([tag, frame()]))).rejects.toThrow(InvalidMp3Error);
    },
  );

  it.each(["size", "version", "role"])(
    "rejects an unusable footer-only APE %s field",
    async (defect) => {
      const tag = ape(Buffer.alloc(20));
      const footer = tag.length - 32;
      if (defect === "size") tag.writeUInt32LE(31, footer + 12);
      if (defect === "version") tag.writeUInt32LE(3000, footer + 8);
      if (defect === "role") tag.writeUInt32LE(0x4000_0000, footer + 20);
      await expect(count(Buffer.concat([frame(), tag]))).rejects.toThrow(InvalidMp3Error);
    },
  );

  it.each(["ID3", "APE"])(
    "uses the %s footer's extent during backward traversal despite header differences",
    async (kind) => {
      const tag = kind === "ID3" ? id3(frame(), 4, true) : ape(frame(), true);
      const headerBytes = kind === "ID3" ? 10 : 32;
      const signatureBytes = kind === "ID3" ? 3 : 8;
      tag.fill(0xff, signatureBytes, headerBytes);
      const bytes = Buffer.concat([frame(), ape(Buffer.alloc(17, 0x55)), tag]);
      expect(await countFrames(chunkBytes(bytes, [1, 7, 32]))).toBe(1);
      // Unlike irrelevant header fields, a missing start signature leaves no
      // supported tag at the footer's calculated boundary.
      tag[0] = 0;
      await expect(
        count(Buffer.concat([frame(), ape(Buffer.alloc(17, 0x55)), tag])),
      ).rejects.toThrow(InvalidMp3Error);
    },
  );

  it("tries another suffix layout when a relaxed APE candidate reaches a dead end", async () => {
    const tag = id3v1();
    const decoy = ape();
    decoy.writeUInt32LE(100, 12);
    decoy.writeUInt32LE(0x101, 20);
    decoy[24] = 1;
    decoy.copy(tag, 96);
    expect(await count(Buffer.concat([frame(), ape(Buffer.alloc(17, 0x55)), tag]))).toBe(1);
  });

  it.each(["version", "length", "footer flag"])(
    "rejects a backward ID3 extent with an unusable %s",
    async (defect) => {
      const tag = id3(Buffer.alloc(12), 4, true);
      const footer = tag.length - 10;
      if (defect === "version") tag[footer + 3] = 5;
      if (defect === "length") tag[footer + 9] = 0x80;
      if (defect === "footer flag") tag[footer + 5] = 0;
      await expect(
        count(Buffer.concat([frame(), ape(Buffer.alloc(17, 0x55)), tag])),
      ).rejects.toThrow(InvalidMp3Error);
    },
  );

  it("observes buffered suffix EOF once and still releases the iterator", async () => {
    const chunks = [frame(), ape(Buffer.alloc(17, 0x55))];
    let pulls = 0;
    let closed = 0;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        return {
          async next() {
            if (pulls > chunks.length) throw new Error("Read after source EOF");
            const value = chunks[pulls++];
            return value ? { done: false, value } : { done: true, value: undefined };
          },
          async return() {
            closed++;
            return { done: true, value: undefined };
          },
        };
      },
    };
    expect(await countFrames(source)).toBe(1);
    expect(pulls).toBe(3);
    expect(closed).toBe(1);
  });

  it.each(["ID3", "APE"])("rejects a truncated declared %s footer", async (kind) => {
    const tag = kind === "ID3" ? id3(Buffer.alloc(12), 4, true) : ape(Buffer.alloc(12), true);
    await expect(count(Buffer.concat([frame(), tag.subarray(0, -1)]))).rejects.toThrow(
      InvalidMp3Error,
    );
  });

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
