import { InvalidMp3Error } from "./error.ts";
import type { StreamReader } from "./reader.ts";

// A footer-only tag gives its size at the end, so its unknown preceding bytes
// must be retained. Bound that memory; declared-size tags are skipped as they arrive.
export const MAX_SUFFIX_BYTES = 64 * 1024;
// Overlapping footer interpretations can create many possible tag chains.
// Bound that search work without limiting ordinary, recognised forward tag chains.
export const MAX_METADATA_ALTERNATIVES = 4096;
// Each backward step inspects small descriptors. Yield every 128 steps so even
// searching after EOF gives timers, cancellation and other requests regular turns.
const METADATA_CHECKPOINT_TRANSITIONS = 128;

const ID3_DESCRIPTOR_BYTES = 10;
const ID3V1_TAG_BYTES = 128;
const ID3_VERSION_OFFSET = 3;
const ID3_FLAGS_OFFSET = 5;
const ID3_SIZE_OFFSET = 6;
const ID3_FOOTER_PRESENT = 0x10;

const APE_SIGNATURE = "APETAGEX";
const APE_DESCRIPTOR_BYTES = 32;
const APE_VERSION_OFFSET = 8;
const APE_SIZE_OFFSET = 12;
const APE_FLAGS_OFFSET = 20;
const APE_VERSION_1 = 1000;
const APE_VERSION_2 = 2000;
const APE_HEADER_PRESENT = 0x8000_0000;
const APE_FOOTER_ABSENT = 0x4000_0000;
const APE_IS_HEADER = 0x2000_0000;
const APE_ROLE_MASK = APE_HEADER_PRESENT | APE_FOOTER_ABSENT | APE_IS_HEADER;
const APE_HEADER_ROLE = (APE_HEADER_PRESENT | APE_IS_HEADER) >>> 0;

/**
 * Consume metadata rather than returning its contents. The caller has already
 * read prefix from the stream; complete the tag using those bytes and input.
 *
 * A supported ID3/APE header owns its whole declared extent, including any footer.
 * Skip those bytes without checking metadata contents or comparing descriptors:
 * only the leading size is needed to find the next audio/metadata boundary.
 * After audio, also accept ID3v1 and bounded footer-only APE metadata.
 *
 * Consume one recognised tag or the entire unknown terminal suffix. The caller
 * reads again to observe EOF and must stay in metadata mode after audio.
 */
export async function consumeMetadata(
  input: StreamReader,
  prefix: Buffer,
  afterAudio: boolean,
): Promise<void> {
  if (startsWith(prefix, "ID3")) {
    const header = await readDescriptor(input, prefix, ID3_DESCRIPTOR_BYTES, "ID3");
    const extent = readId3Extent(header);
    if (!extent) throw new InvalidMp3Error("Unsupported ID3 version or unusable length.");
    await input.skip(
      extent.payloadBytes + (extent.hasFooter ? ID3_DESCRIPTOR_BYTES : 0),
      "ID3 extent",
    );
    return;
  }
  if (startsWith(prefix, "APET")) {
    const header = await readDescriptor(input, prefix, APE_DESCRIPTOR_BYTES, "APE");
    if (
      startsWith(header, APE_SIGNATURE) &&
      header.readUInt32LE(APE_VERSION_OFFSET) === APE_VERSION_2 &&
      (header.readUInt32LE(APE_FLAGS_OFFSET) & APE_ROLE_MASK) >>> 0 === APE_HEADER_ROLE
    ) {
      // APE size includes the footer but excludes this separate header. The
      // footer's contents cannot change the boundary supplied by this header.
      const tagBytesIncludingFooter = header.readUInt32LE(APE_SIZE_OFFSET);
      if (tagBytesIncludingFooter < APE_DESCRIPTOR_BYTES)
        throw new InvalidMp3Error("Invalid APE extent.");
      await input.skip(tagBytesIncludingFooter, "APE extent");
      return;
    }
    if (!afterAudio) {
      throw new InvalidMp3Error("Leading APE requires a supported version-two header.");
    }
    await consumeUnknownSuffix(input, header);
    return;
  }
  if (afterAudio && startsWith(prefix, "TAG")) {
    await input.skip(ID3V1_TAG_BYTES - prefix.length, "ID3v1 tag");
    return;
  }
  if (!afterAudio) throw new InvalidMp3Error("Invalid or unsupported MPEG input.");
  await consumeUnknownSuffix(input, prefix);
}

/** Copy a descriptor before another pull can let its producer reuse the previous chunk. */
async function readDescriptor(
  input: StreamReader,
  prefix: Buffer,
  length: number,
  kind: string,
): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  prefix.copy(bytes);
  const rest = await input.read(length - prefix.length);
  if (rest.length !== length - prefix.length) {
    throw new InvalidMp3Error(`Incomplete ${kind} descriptor.`);
  }
  rest.copy(bytes, prefix.length);
  return bytes;
}

/**
 * A footer-only APE tag cannot be skipped forward: its size has not arrived yet.
 * Collect only this bounded unknown tail, then locate its complete tag chain.
 * Recognised ID3/APE headers above avoid this buffer by supplying a leading size.
 */
async function consumeUnknownSuffix(input: StreamReader, prefix: Buffer): Promise<void> {
  const suffix = Buffer.alloc(MAX_SUFFIX_BYTES);
  prefix.copy(suffix);
  let length = prefix.length;
  while (true) {
    const view = await input.view();
    if (view.length === 0) break;
    if (length + view.length > MAX_SUFFIX_BYTES) {
      throw new InvalidMp3Error("Unknown metadata suffix exceeded its buffer limit.");
    }
    view.copy(suffix, length);
    length += view.length;
    input.advance(view.length);
  }
  await checkMetadataBoundaries(suffix.subarray(0, length), input);
}

/**
 * Work backward from the suffix's end, removing one complete tag at each step.
 * Offsets are relative to bytes, and end offsets point just past the last byte.
 * Reaching start offset zero accounts for every buffered byte as metadata;
 * accepting leftover bytes could otherwise hide additional or truncated audio.
 *
 * A footer can support more than one interpretation. Follow the first, saving
 * other possible end offsets on a stack to try if that chain reaches a dead end.
 */
async function checkMetadataBoundaries(bytes: Buffer, input: StreamReader): Promise<void> {
  const pendingEndOffsets = [bytes.length];
  let alternativeChains = 0;
  let transitions = 0;
  while (pendingEndOffsets.length > 0) {
    let endOffset = pendingEndOffsets.pop();
    if (endOffset === undefined) break;
    while (endOffset > 0) {
      // No input is pulled after EOF, but backward searching still consumes CPU.
      // Yield regularly so cancellation and other work can run during this phase.
      if (++transitions % METADATA_CHECKPOINT_TRANSITIONS === 0) await input.checkpoint();
      const candidates = findTagStartCandidates(bytes, endOffset);
      if (candidates.includes(0)) return;
      const nextEndOffset = candidates[0];
      if (nextEndOffset === undefined) break;
      for (const alternativeEndOffset of candidates.slice(1)) {
        if (++alternativeChains > MAX_METADATA_ALTERNATIVES) {
          throw new InvalidMp3Error("Too many alternative metadata chains.");
        }
        pendingEndOffsets.push(alternativeEndOffset);
      }
      endOffset = nextEndOffset;
    }
  }
  throw new InvalidMp3Error("The terminal suffix has no complete supported metadata layout.");
}

/** Find complete tags ending at endOffset; preserve APE, ID3v2, then ID3v1 preference. */
function findTagStartCandidates(bytes: Buffer, endOffset: number): number[] {
  const startOffsets: number[] = [];
  if (endOffset >= APE_DESCRIPTOR_BYTES) {
    const footer = bytes.subarray(endOffset - APE_DESCRIPTOR_BYTES, endOffset);
    const extent = readApeFooterExtent(footer);
    if (extent) {
      // Here the footer supplies the size. A declared separate header must
      // start at that boundary, but its metadata fields need not match.
      const startOffset =
        endOffset - extent.tagBytesIncludingFooter - (extent.hasHeader ? APE_DESCRIPTOR_BYTES : 0);
      if (
        startOffset >= 0 &&
        (!extent.hasHeader || startsWith(bytes.subarray(startOffset), APE_SIGNATURE))
      )
        startOffsets.push(startOffset);
    }
  }
  if (endOffset >= ID3_DESCRIPTOR_BYTES) {
    const footer = bytes.subarray(endOffset - ID3_DESCRIPTOR_BYTES, endOffset);
    if (startsWith(footer, "3DI")) {
      const extent = readId3Extent(footer);
      if (extent?.hasFooter) {
        // ID3's payload length excludes both its header and its footer.
        const startOffset =
          endOffset - ID3_DESCRIPTOR_BYTES - extent.payloadBytes - ID3_DESCRIPTOR_BYTES;
        if (startOffset >= 0 && startsWith(bytes.subarray(startOffset), "ID3"))
          startOffsets.push(startOffset);
      }
    }
  }
  if (
    endOffset >= ID3V1_TAG_BYTES &&
    startsWith(bytes.subarray(endOffset - ID3V1_TAG_BYTES, endOffset), "TAG")
  )
    startOffsets.push(endOffset - ID3V1_TAG_BYTES);
  return startOffsets;
}

/** Read only boundary fields; ID3 revisions and unrelated flags do not affect size. */
function readId3Extent(header: Buffer): { payloadBytes: number; hasFooter: boolean } | undefined {
  const major = header.readUInt8(ID3_VERSION_OFFSET);
  const flags = header.readUInt8(ID3_FLAGS_OFFSET);
  if (major !== 2 && major !== 3 && major !== 4) return undefined;
  let payloadBytes = 0;
  // A synchsafe length is four seven-bit digits, most significant first. The
  // high bit of each byte must be zero; multiplying by 128 advances one digit.
  for (const byte of header.subarray(ID3_SIZE_OFFSET)) {
    if (byte > 127) return undefined;
    payloadBytes = payloadBytes * 128 + byte;
  }
  // Only ID3v2.4 defines this bit as an extra ten-byte footer.
  return { payloadBytes, hasFooter: major === 4 && (flags & ID3_FOOTER_PRESENT) !== 0 };
}

/**
 * An APE footer's size includes itself and payload, but excludes a separate
 * header. Ignore item counts, reserved bytes and flags unrelated to layout.
 * Return no candidate if the size/version/role cannot locate a supported tag.
 */
function readApeFooterExtent(
  footer: Buffer,
): { tagBytesIncludingFooter: number; hasHeader: boolean } | undefined {
  if (!startsWith(footer, APE_SIGNATURE)) return undefined;
  const version = footer.readUInt32LE(APE_VERSION_OFFSET);
  const tagBytesIncludingFooter = footer.readUInt32LE(APE_SIZE_OFFSET);
  const flags = footer.readUInt32LE(APE_FLAGS_OFFSET);
  if (
    (version !== APE_VERSION_1 && version !== APE_VERSION_2) ||
    tagBytesIncludingFooter < APE_DESCRIPTOR_BYTES ||
    (version === APE_VERSION_2 && (flags & (APE_FOOTER_ABSENT | APE_IS_HEADER)) !== 0)
  ) {
    return undefined;
  }
  return {
    tagBytesIncludingFooter,
    hasHeader: version === APE_VERSION_2 && (flags & APE_HEADER_PRESENT) !== 0,
  };
}

function startsWith(bytes: Buffer, text: string): boolean {
  return bytes.length >= text.length && bytes.toString("latin1", 0, text.length) === text;
}
