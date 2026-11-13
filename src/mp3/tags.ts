import { InvalidMp3Error } from "./error.ts";
import type { StreamReader } from "./reader.ts";

// A footer-only tag gives its size at the end, so its unknown preceding bytes
// must be retained. Bound that memory; declared-size tags are skipped as they arrive.
export const MAX_SUFFIX_BYTES = 64 * 1024;
// Overlapping footer interpretations can create many possible tag chains.
// Bound that search work without limiting ordinary, recognised forward tag chains.
export const MAX_METADATA_ALTERNATIVES = 4096;
// Each backward step inspects small descriptors. Yield every 128 steps so even
// validation after EOF gives timers, cancellation and other requests regular turns.
const METADATA_CHECKPOINT_TRANSITIONS = 128;

const ID3_DESCRIPTOR_BYTES = 10;
const ID3V1_TAG_BYTES = 128;
const ID3_VERSION_OFFSET = 3;
const ID3_REVISION_OFFSET = 4;
const ID3_FLAGS_OFFSET = 5;
const ID3_SIZE_OFFSET = 6;
const ID3_FOOTER_PRESENT = 0x10;
// ID3v2.2, v2.3 and v2.4 allow the top two, three and four flag bits respectively.
const ID3_ALLOWED_FLAGS: Readonly<Partial<Record<number, number>>> = {
  2: 0xc0,
  3: 0xe0,
  4: 0xf0,
};

const APE_SIGNATURE = "APETAGEX";
const APE_DESCRIPTOR_BYTES = 32;
const APE_VERSION_OFFSET = 8;
const APE_SIZE_OFFSET = 12;
const APE_FLAGS_OFFSET = 20;
const APE_RESERVED_OFFSET = 24;
const APE_VERSION_1 = 1000;
const APE_VERSION_2 = 2000;
const APE_HEADER_PRESENT = 0x8000_0000;
const APE_FOOTER_ABSENT = 0x4000_0000;
const APE_IS_HEADER = 0x2000_0000;
const APE_READ_ONLY = 1;
const APE_ROLE_MASK = APE_HEADER_PRESENT | APE_FOOTER_ABSENT | APE_IS_HEADER;
const APE_HEADER_ROLE = (APE_HEADER_PRESENT | APE_IS_HEADER) >>> 0;
const APE_ALLOWED_FOOTER_FLAGS = APE_HEADER_PRESENT | APE_READ_ONLY;

/**
 * Consume metadata rather than returning its contents. The caller has already
 * read prefix from the stream; complete the tag using those bytes and input.
 *
 * Before audio, accept supported leading ID3 headers and paired APEv2 tags.
 * After audio, also accept ID3v1 and footer-only APE; appended ID3v2 requires a
 * matching ID3v2.4 header/footer pair. A recognised tag owns its whole declared size,
 * so tag-like or frame-like bytes inside its payload are not examined.
 *
 * "continue" means one tag was consumed and traversal can continue. The caller
 * must remain in metadata mode after audio: later bytes cannot resume counting.
 * "end-of-stream" means the entire remaining suffix was consumed and validated.
 */
export async function consumeMetadata(
  input: StreamReader,
  prefix: Buffer,
  afterAudio: boolean,
): Promise<"continue" | "end-of-stream"> {
  if (startsWith(prefix, "ID3")) {
    const header = await readDescriptor(input, prefix, ID3_DESCRIPTOR_BYTES, "ID3");
    const extent = readId3Descriptor(header);
    if (afterAudio && (header[ID3_VERSION_OFFSET] !== 4 || !extent.hasFooter)) {
      throw new InvalidMp3Error("Appended ID3 requires a paired version-four envelope.");
    }
    await input.skip(extent.payloadBytes, "ID3 payload");
    if (extent.hasFooter) {
      validateId3Pair(
        header,
        await readDescriptor(input, Buffer.alloc(0), ID3_DESCRIPTOR_BYTES, "ID3 footer"),
      );
    }
    return "continue";
  }
  if (startsWith(prefix, "APET")) {
    const header = await readDescriptor(input, prefix, APE_DESCRIPTOR_BYTES, "APE");
    if (
      startsWith(header, APE_SIGNATURE) &&
      header.readUInt32LE(APE_VERSION_OFFSET) === APE_VERSION_2 &&
      (header.readUInt32LE(APE_FLAGS_OFFSET) & APE_ROLE_MASK) >>> 0 === APE_HEADER_ROLE
    ) {
      // APE size includes the footer but excludes this separate header.
      const tagBytesIncludingFooter = header.readUInt32LE(APE_SIZE_OFFSET);
      if (tagBytesIncludingFooter < APE_DESCRIPTOR_BYTES)
        throw new InvalidMp3Error("Invalid APE extent.");
      await input.skip(tagBytesIncludingFooter - APE_DESCRIPTOR_BYTES, "APE payload");
      const footer = await readDescriptor(
        input,
        Buffer.alloc(0),
        APE_DESCRIPTOR_BYTES,
        "APE footer",
      );
      readApeFooter(footer);
      validateApePair(header, footer);
      return "continue";
    }
    if (!afterAudio) {
      throw new InvalidMp3Error("Leading APEv2 requires a header and matching footer.");
    }
    return await consumeUnknownSuffix(input, header);
  }
  if (afterAudio && startsWith(prefix, "TAG")) {
    await input.skip(ID3V1_TAG_BYTES - prefix.length, "ID3v1 tag");
    return "continue";
  }
  if (!afterAudio) throw new InvalidMp3Error("Invalid or unsupported MPEG input.");
  return await consumeUnknownSuffix(input, prefix);
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
 * Collect only this bounded unknown tail, then validate its complete tag chain.
 * Recognised ID3/APE headers above avoid this buffer by supplying a leading size.
 */
async function consumeUnknownSuffix(input: StreamReader, prefix: Buffer): Promise<"end-of-stream"> {
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
  await validateMetadataSuffix(suffix.subarray(0, length), input);
  return "end-of-stream";
}

/**
 * Work backward from the suffix's end, removing one complete tag at each step.
 * Offsets are relative to bytes, and end offsets point just past the last byte.
 * Reaching start offset zero proves every buffered byte belongs to metadata.
 *
 * A footer can support more than one interpretation. Follow the first, saving
 * other possible end offsets on a stack to try if that chain reaches a dead end.
 */
async function validateMetadataSuffix(bytes: Buffer, input: StreamReader): Promise<void> {
  const pendingEndOffsets = [bytes.length];
  let alternativeChains = 0;
  let transitions = 0;
  let rememberedMalformedTag: InvalidMp3Error | undefined;
  while (pendingEndOffsets.length > 0) {
    let endOffset = pendingEndOffsets.pop();
    if (endOffset === undefined) break;
    while (endOffset > 0) {
      // No input is pulled after EOF, but backward searching still consumes CPU.
      // Yield regularly so cancellation and other work can run during this phase.
      if (++transitions % METADATA_CHECKPOINT_TRANSITIONS === 0) await input.checkpoint();
      const candidates = findTagStartCandidates(bytes, endOffset);
      if (candidates.startOffsets.includes(0)) return;
      const nextEndOffset = candidates.startOffsets[0];
      if (nextEndOffset === undefined) {
        // A malformed interpretation does not rule out a different complete chain.
        // Keep its error to report only if every saved interpretation also fails.
        rememberedMalformedTag ??= candidates.malformed;
        break;
      }
      for (const alternativeEndOffset of candidates.startOffsets.slice(1)) {
        if (++alternativeChains > MAX_METADATA_ALTERNATIVES) {
          throw new InvalidMp3Error("Too many alternative metadata chains.");
        }
        pendingEndOffsets.push(alternativeEndOffset);
      }
      endOffset = nextEndOffset;
    }
  }
  throw (
    rememberedMalformedTag ??
    new InvalidMp3Error("The terminal suffix is not complete supported metadata.")
  );
}

/** Find complete tags ending at endOffset; preserve APE, ID3v2, then ID3v1 preference. */
function findTagStartCandidates(
  bytes: Buffer,
  endOffset: number,
): { startOffsets: number[]; malformed: InvalidMp3Error | undefined } {
  const startOffsets: number[] = [];
  let malformed: InvalidMp3Error | undefined;
  if (endOffset >= APE_DESCRIPTOR_BYTES) {
    const footer = bytes.subarray(endOffset - APE_DESCRIPTOR_BYTES, endOffset);
    if (startsWith(footer, APE_SIGNATURE)) {
      try {
        const descriptor = readApeFooter(footer);
        // The footer's size already includes itself. Subtract a separate header
        // only when its presence is declared, and validate that header if so.
        const startOffset =
          endOffset -
          descriptor.tagBytesIncludingFooter -
          (descriptor.hasHeader ? APE_DESCRIPTOR_BYTES : 0);
        if (startOffset < 0) throw new InvalidMp3Error("Invalid APE extent.");
        if (descriptor.hasHeader)
          validateApePair(bytes.subarray(startOffset, startOffset + APE_DESCRIPTOR_BYTES), footer);
        startOffsets.push(startOffset);
      } catch (error) {
        if (!(error instanceof InvalidMp3Error)) throw error;
        malformed = error;
      }
    }
  }
  if (endOffset >= ID3_DESCRIPTOR_BYTES) {
    const footer = bytes.subarray(endOffset - ID3_DESCRIPTOR_BYTES, endOffset);
    if (startsWith(footer, "3DI")) {
      try {
        const extent = readId3Descriptor(footer);
        // ID3's payload length excludes both its header and its footer.
        const startOffset =
          endOffset - ID3_DESCRIPTOR_BYTES - extent.payloadBytes - ID3_DESCRIPTOR_BYTES;
        if (footer[ID3_VERSION_OFFSET] !== 4 || !extent.hasFooter || startOffset < 0) {
          throw new InvalidMp3Error("Invalid appended ID3v2.4 extent.");
        }
        validateId3Pair(bytes.subarray(startOffset, startOffset + ID3_DESCRIPTOR_BYTES), footer);
        startOffsets.push(startOffset);
      } catch (error) {
        if (!(error instanceof InvalidMp3Error)) throw error;
        malformed = error;
      }
    }
  }
  if (
    endOffset >= ID3V1_TAG_BYTES &&
    startsWith(bytes.subarray(endOffset - ID3V1_TAG_BYTES, endOffset), "TAG")
  )
    startOffsets.push(endOffset - ID3V1_TAG_BYTES);
  return { startOffsets, malformed };
}

/** Decode a 10-byte ID3v2 header/footer; payloadBytes excludes both descriptors. */
function readId3Descriptor(header: Buffer): { payloadBytes: number; hasFooter: boolean } {
  if (header.length !== ID3_DESCRIPTOR_BYTES) throw new InvalidMp3Error("Incomplete ID3 header.");
  const major = header.readUInt8(ID3_VERSION_OFFSET);
  const flags = header.readUInt8(ID3_FLAGS_OFFSET);
  const allowedFlags = ID3_ALLOWED_FLAGS[major];
  if (
    allowedFlags === undefined ||
    header[ID3_REVISION_OFFSET] === 255 ||
    (flags & ~allowedFlags) !== 0
  ) {
    throw new InvalidMp3Error("Unsupported ID3 version or flags.");
  }
  let payloadBytes = 0;
  // A synchsafe length is four seven-bit digits, most significant first. The
  // high bit of each byte must be zero; multiplying by 128 advances one digit.
  for (const byte of header.subarray(ID3_SIZE_OFFSET)) {
    if (byte > 127) throw new InvalidMp3Error("ID3 length is not synchsafe.");
    payloadBytes = payloadBytes * 128 + byte;
  }
  return { payloadBytes, hasFooter: (flags & ID3_FOOTER_PRESENT) !== 0 };
}

/** A footer reverses ID3 to 3DI, but its version, flags and size must match. */
function validateId3Pair(header: Buffer, footer: Buffer): void {
  if (
    !startsWith(header, "ID3") ||
    !startsWith(footer, "3DI") ||
    !header.subarray(ID3_VERSION_OFFSET).equals(footer.subarray(ID3_VERSION_OFFSET))
  ) {
    throw new InvalidMp3Error("ID3 header and footer disagree.");
  }
}

/**
 * Validate/decode an APE footer. Its size includes the footer and payload, but
 * excludes a separate header. hasHeader is the footer's claim; the pair must
 * still be checked by validateApePair before accepting that interpretation.
 */
function readApeFooter(footer: Buffer): { tagBytesIncludingFooter: number; hasHeader: boolean } {
  if (footer.length !== APE_DESCRIPTOR_BYTES || !startsWith(footer, APE_SIGNATURE)) {
    throw new InvalidMp3Error("Incomplete APE footer.");
  }
  const version = footer.readUInt32LE(APE_VERSION_OFFSET);
  const tagBytesIncludingFooter = footer.readUInt32LE(APE_SIZE_OFFSET);
  const flags = footer.readUInt32LE(APE_FLAGS_OFFSET);
  if (
    (version !== APE_VERSION_1 && version !== APE_VERSION_2) ||
    (version === APE_VERSION_1 && flags !== 0) ||
    tagBytesIncludingFooter < APE_DESCRIPTOR_BYTES ||
    (flags & ~APE_ALLOWED_FOOTER_FLAGS) !== 0 ||
    footer.subarray(APE_RESERVED_OFFSET).some((byte) => byte !== 0)
  ) {
    throw new InvalidMp3Error("Invalid APE descriptor or length.");
  }
  return {
    tagBytesIncludingFooter,
    hasHeader: version === APE_VERSION_2 && (flags & APE_HEADER_PRESENT) !== 0,
  };
}

/** Paired APE descriptors match except for the flag identifying the header. */
function validateApePair(header: Buffer, footer: Buffer): void {
  if (
    !startsWith(header, APE_SIGNATURE) ||
    !header.subarray(0, APE_FLAGS_OFFSET).equals(footer.subarray(0, APE_FLAGS_OFFSET)) ||
    header.readUInt32LE(APE_FLAGS_OFFSET) !==
      (footer.readUInt32LE(APE_FLAGS_OFFSET) | APE_IS_HEADER) >>> 0 ||
    !header.subarray(APE_RESERVED_OFFSET).equals(footer.subarray(APE_RESERVED_OFFSET))
  ) {
    throw new InvalidMp3Error("APE header and footer disagree.");
  }
}

function startsWith(bytes: Buffer, text: string): boolean {
  return bytes.length >= text.length && bytes.toString("latin1", 0, text.length) === text;
}
