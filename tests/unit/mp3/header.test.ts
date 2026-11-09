import { describe, expect, it } from "vitest";
import { readHeader } from "../../../src/mp3/header.ts";

describe("indexed MPEG-1 Layer III headers", () => {
  it.each([
    ["fffb9000", 128, 44_100, 417],
    ["fffa9200", 128, 44_100, 418],
    ["fffb54c0", 64, 48_000, 192],
    ["fffb78c0", 96, 32_000, 432],
    ["fffb1000", 32, 44_100, 104],
    ["fffbe800", 320, 32_000, 1440],
  ])("reads the literal %s header", (hex, bitrateKbps, sampleRateHz, frameBytes) => {
    expect(readHeader(Buffer.from(hex, "hex"))).toEqual({ bitrateKbps, sampleRateHz, frameBytes });
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
    ["deferred free format", "fffb0000"],
    ["reserved bitrate", "fffbf000"],
    ["reserved rate", "fffb9c00"],
    ["reserved emphasis", "fffb9002"],
  ])("does not infer a length from a %s header", (_name, hex) => {
    expect(readHeader(Buffer.from(hex, "hex"))).toBeUndefined();
  });
});
