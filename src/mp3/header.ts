const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
const SAMPLE_RATES_HZ = [44_100, 48_000, 32_000] as const;

export interface FrameHeader {
  readonly bitrateKbps: number;
  readonly sampleRateHz: number;
  readonly frameBytes: number;
}

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
  if (!bitrateKbps || !sampleRateHz) return undefined;
  const padding = (word >>> 9) & 1;
  return {
    bitrateKbps,
    sampleRateHz,
    frameBytes: Math.floor((144_000 * bitrateKbps) / sampleRateHz) + padding,
  };
}
