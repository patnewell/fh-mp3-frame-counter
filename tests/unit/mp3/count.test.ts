import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { countFrames } from "../../../src/mp3/count.ts";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { frame, id3, id3v1, withMp3 } from "../../helpers/mp3.ts";

const count = (bytes: Uint8Array) => withMp3(bytes, countFrames);

describe("physical frame count", () => {
  it("counts complete frames using each header's rate, padding and bitrate", async () => {
    expect(
      await count(Buffer.concat([frame(), frame("fffa9200", 418), frame("fffb78c0", 432)])),
    ).toBe(3);
  });

  it.each(["Xing", "Info", "VBRI"])(
    "counts a %s carrier without reading its claimed count",
    async (marker) => {
      const carrier = frame();
      carrier.write(marker, 36);
      carrier.writeUInt32BE(0xffff_ffff, 44);
      Buffer.from("fffb9000", "hex").copy(carrier, 100);
      expect(await count(Buffer.concat([carrier, frame()]))).toBe(2);
    },
  );

  it.each([2, 3, 4])("skips ID3v2.%i without counting frame-like tag bytes", async (version) => {
    expect(await count(Buffer.concat([id3(frame(), version), frame(), id3v1()]))).toBe(1);
  });

  it("accepts repeated leading tags and matching ID3v2.4 footer", async () => {
    expect(await count(Buffer.concat([id3(frame()), id3(frame(), 4, true), frame()]))).toBe(1);
  });

  it("does not trim a TAG signature inside a frame", async () => {
    const bytes = frame();
    bytes.write("TAG", bytes.length - 128);
    expect(await count(bytes)).toBe(1);
    expect(await count(Buffer.concat([bytes, id3v1()]))).toBe(1);
  });

  it.each([
    ["empty", Buffer.alloc(0)],
    ["tag-only", id3()],
    ["trailer-only", id3v1()],
    ["short header", Buffer.from("fffb90", "hex")],
    ["short frame", frame().subarray(0, 416)],
    ["MPEG-2", frame("fff39000")],
    ["prefix junk", Buffer.concat([Buffer.from([1]), frame()])],
    ["middle junk", Buffer.concat([frame(), Buffer.from([1]), frame()])],
    ["suffix junk", Buffer.concat([frame(), Buffer.from([1])])],
    ["truncated frame then tag", Buffer.concat([frame().subarray(0, 416), id3v1()])],
  ])("rejects %s instead of returning a partial count", async (_name, bytes) => {
    await expect(count(bytes)).rejects.toThrow(InvalidMp3Error);
  });

  it.each([
    ["short ID3 header", Buffer.from("ID3")],
    ["unknown ID3 version", Buffer.from("49443305000000000000", "hex")],
    ["invalid revision", Buffer.from("49443304ff0000000000", "hex")],
    ["reserved ID3 flag", Buffer.from("49443303001000000000", "hex")],
    ["non-synchsafe length", Buffer.from("49443304000000000080", "hex")],
    ["incomplete ID3 payload", Buffer.from("49443304000000000001", "hex")],
  ])("rejects a %s", async (_name, bytes) => {
    await expect(count(bytes)).rejects.toThrow(InvalidMp3Error);
  });

  it("requires the declared ID3 footer to match", async () => {
    const tag = id3(Buffer.alloc(7), 4, true);
    tag[tag.length - 1] = 1;
    await expect(count(Buffer.concat([tag, frame()]))).rejects.toThrow(/footer/);
  });

  it("propagates cancellation before opening a path", async () => {
    const reason = new Error("Cancelled");
    await expect(countFrames("missing.mp3", AbortSignal.abort(reason))).rejects.toBe(reason);
  });

  it("preserves filesystem errors for the caller", async () => {
    await withMp3(frame(), async (path) => {
      await rm(path);
      await expect(countFrames(path)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});
