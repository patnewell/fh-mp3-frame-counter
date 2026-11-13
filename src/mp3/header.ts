export const FRAME_HEADER_BYTES = 4;

// Header fields contain table indices, not literal bitrates or sample rates.
// Bitrate index 0 marks free format; the omitted index 15 is reserved/invalid.
const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
// Sample-rate index 3 is reserved/invalid and deliberately has no table entry.
const SAMPLE_RATES_HZ = [44_100, 48_000, 32_000] as const;

interface FramingFields {
  readonly sampleRateHz: number;
  /** Extra bytes added to this frame: its padding flag is either 0 or 1. */
  readonly padding: number;
  /** Header + any CRC + side information; this is overhead, not the full frame size. */
  readonly minimumBytes: number;
}

/** Only an indexed-bitrate header supplies a calculable total frameBytes, including its header. */
export type FrameHeader = FramingFields &
  (
    | { readonly kind: "indexed"; readonly bitrateKbps: number; readonly frameBytes: number }
    | { readonly kind: "free" }
  );

/**
 * Interpret the first four bytes as a supported MPEG-1 Layer III header.
 * Return undefined for short input, invalid fields or unsupported versions/layers.
 * This reads framing information; it does not decode audio or verify CRC values.
 */
export function readHeader(bytes: Buffer): FrameHeader | undefined {
  if (bytes.length < FRAME_HEADER_BYTES) return undefined;
  const word = bytes.readUInt32BE();
  const syncBits = word >>> 21;
  const version = (word >>> 19) & 3;
  const layer = (word >>> 17) & 3;
  const emphasis = word & 3;

  // Eleven leading one-bits mark a possible header. Version bits 0b11 select MPEG-1,
  // layer bits 0b01 select Layer III, and emphasis bits 0b10 are reserved by the format.
  if (syncBits !== 0x7ff || version !== 0b11 || layer !== 0b01 || emphasis === 0b10) {
    return undefined;
  }

  const bitrateIndex = (word >>> 12) & 15;
  const sampleRateIndex = (word >>> 10) & 3;
  const bitrateKbps = BITRATES_KBPS[bitrateIndex];
  const sampleRateHz = SAMPLE_RATES_HZ[sampleRateIndex];
  if (bitrateKbps === undefined || sampleRateHz === undefined) return undefined;

  const padding = (word >>> 9) & 1;
  const protectionBit = (word >>> 16) & 1;
  const channelMode = (word >>> 6) & 3;

  // The protection flag is inverted: zero means a two-byte CRC follows the header.
  const crcBytes = protectionBit === 0 ? 2 : 0;
  // Side information describes how to decode the audio: 17 bytes for mono (channel-mode bits 0b11),
  // 32 for the two-channel modes. Both sizes are specific to MPEG-1 Layer III.
  const sideInformationBytes = channelMode === 0b11 ? 17 : 32;
  const framing = {
    sampleRateHz,
    padding,
    minimumBytes: FRAME_HEADER_BYTES + crcBytes + sideInformationBytes,
  };

  // Zero is the free-format marker, not 0 kb/s: its size must be discovered separately.
  if (bitrateKbps === 0) return { kind: "free", ...framing };

  // MPEG-1 Layer III has 1152 samples per frame. Frame duration (1152 / sampleRateHz)
  // times bitrate in bytes/second gives its size: 1152 × 1000 / 8 = 144000.
  // Round down to whole bytes, then add this frame's optional padding byte.
  return {
    kind: "indexed",
    ...framing,
    bitrateKbps,
    frameBytes: Math.floor((144_000 * bitrateKbps) / sampleRateHz) + padding,
  };
}
