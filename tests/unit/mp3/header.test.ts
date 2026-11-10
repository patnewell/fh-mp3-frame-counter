import { describe, expect, it } from "vitest";
import { readHeader } from "../../../src/mp3/header.ts";

describe("MPEG-1 Layer III headers", () => {
  it.each([
    ["fffb9000", 128, 44_100, 417],
    ["fffa9200", 128, 44_100, 418],
    ["fffb54c0", 64, 48_000, 192],
    ["fffb78c0", 96, 32_000, 432],
    ["fffb1000", 32, 44_100, 104],
    ["fffbe800", 320, 32_000, 1440],
  ])("reads the literal %s header", (hex, bitrateKbps, sampleRateHz, frameBytes) => {
    expect(readHeader(Buffer.from(hex, "hex"))).toMatchObject({
      kind: "indexed",
      bitrateKbps,
      sampleRateHz,
      frameBytes,
    });
  });

  it.each([
    ["fffb0000", 44_100, 0, 36],
    ["fffa0000", 44_100, 0, 38],
    ["fffb00c0", 44_100, 0, 21],
    ["fffa00c0", 44_100, 0, 23],
    ["fffb0600", 48_000, 1, 36],
  ])("preserves free-format framing fields in %s", (hex, sampleRateHz, padding, minimumBytes) => {
    expect(readHeader(Buffer.from(hex, "hex"))).toEqual({
      kind: "free",
      sampleRateHz,
      padding,
      minimumBytes,
    });
  });

  it.each([
    ["short", "fffb90"],
    ["empty", ""],
    ["missing sync", "7ffb9000"],
    ["incomplete sync", "ffdb9000"],
    ["MPEG-2", "fff39000"],
    ["MPEG-2.5", "ffe39000"],
    ["reserved version", "ffeb9000"],
    ["Layer I", "ffff9000"],
    ["Layer II", "fffd9000"],
    ["reserved layer", "fff99000"],
    ["reserved bitrate", "fffbf000"],
    ["reserved rate", "fffb9c00"],
    ["reserved emphasis", "fffb9002"],
  ])("does not infer a length from a %s header", (_name, hex) => {
    expect(readHeader(Buffer.from(hex, "hex"))).toBeUndefined();
  });
});
