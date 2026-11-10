const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
const SAMPLE_RATES_HZ = [44_100, 48_000, 32_000] as const;

interface FramingFields {
  readonly sampleRateHz: number;
  readonly padding: number;
  readonly minimumBytes: number;
}

export type FrameHeader = FramingFields &
  (
    | { readonly kind: "indexed"; readonly bitrateKbps: number; readonly frameBytes: number }
    | { readonly kind: "free" }
  );

/** Decode the framing fields; CRC and compressed audio contents are not validated. */
export function readHeader(bytes: Buffer): FrameHeader | undefined {
  if (bytes.length < 4) return undefined;
  const word = bytes.readUInt32BE();
  if (
    word >>> 21 !== 0x7ff ||
    ((word >>> 19) & 3) !== 3 ||
    ((word >>> 17) & 3) !== 1 ||
    (word & 3) === 2
  ) {
    return undefined;
  }

  const bitrateKbps = BITRATES_KBPS[(word >>> 12) & 15];
  const sampleRateHz = SAMPLE_RATES_HZ[(word >>> 10) & 3];
  if (bitrateKbps === undefined || sampleRateHz === undefined) return undefined;
  const padding = (word >>> 9) & 1;
  const crcBytes = (word & 0x1_0000) === 0 ? 2 : 0;
  const sideInformationBytes = ((word >>> 6) & 3) === 3 ? 17 : 32;
  const framing = { sampleRateHz, padding, minimumBytes: 4 + crcBytes + sideInformationBytes };
  if (bitrateKbps === 0) return { kind: "free", ...framing };
  return {
    kind: "indexed",
    ...framing,
    bitrateKbps,
    frameBytes: Math.floor((144_000 * bitrateKbps) / sampleRateHz) + padding,
  };
}
