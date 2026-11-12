import { InvalidMp3Error } from "./error.ts";
import type { StreamReader } from "./reader.ts";

export const MAX_SUFFIX_BYTES = 64 * 1024;
export const MAX_METADATA_ALTERNATIVES = 4096;
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

/** Forward recognized envelopes own their declared extent; only an unknown tail needs lookbehind. */
export async function readTag(
  input: StreamReader,
  prefix: Buffer,
  afterAudio: boolean,
): Promise<"next" | "eof"> {
  if (startsWith(prefix, "ID3")) {
    const header = await descriptor(input, prefix, 10, "ID3");
    const extent = id3Extent(header);
    if (afterAudio && (header[3] !== 4 || !extent.hasFooter)) {
      throw new InvalidMp3Error("Appended ID3 requires a paired version-four envelope.");
    }
    await input.skip(extent.payloadBytes, "ID3 payload");
    if (extent.hasFooter) {
      matchId3Pair(header, await descriptor(input, Buffer.alloc(0), 10, "ID3 footer"));
    }
    return "next";
  }
  if (startsWith(prefix, "APET")) {
    const header = await descriptor(input, prefix, APE_DESCRIPTOR_BYTES, "APE");
    if (
      startsWith(header, APE_SIGNATURE) &&
      header.readUInt32LE(APE_VERSION_OFFSET) === APE_VERSION_2 &&
      (header.readUInt32LE(APE_FLAGS_OFFSET) & APE_ROLE_MASK) >>> 0 === APE_HEADER_ROLE
    ) {
      const size = header.readUInt32LE(APE_SIZE_OFFSET);
      if (size < APE_DESCRIPTOR_BYTES) throw new InvalidMp3Error("Invalid APE extent.");
      await input.skip(size - APE_DESCRIPTOR_BYTES, "APE payload");
      const footer = await descriptor(input, Buffer.alloc(0), APE_DESCRIPTOR_BYTES, "APE footer");
      apeFooter(footer);
      matchApePair(header, footer);
      return "next";
    }
    if (!afterAudio) {
      throw new InvalidMp3Error("Leading APEv2 requires a header and matching footer.");
    }
    return await unknownSuffix(input, header);
  }
  if (afterAudio && startsWith(prefix, "TAG")) {
    await input.skip(128 - prefix.length, "ID3v1 tag");
    return "next";
  }
  if (!afterAudio) throw new InvalidMp3Error("Invalid or unsupported MPEG input.");
  return await unknownSuffix(input, prefix);
}

/** Copy a descriptor before another pull can let its producer reuse the previous chunk. */
async function descriptor(
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

async function unknownSuffix(input: StreamReader, prefix: Buffer): Promise<"eof"> {
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
  await validateSuffix(suffix.subarray(0, length), input);
  return "eof";
}

/** Bounded in-memory fallback for footer-only envelopes whose extent arrives at the end. */
async function validateSuffix(bytes: Buffer, input: StreamReader): Promise<void> {
  const ends = [bytes.length];
  let alternatives = 0;
  let work = 0;
  let malformed: InvalidMp3Error | undefined;
  while (ends.length > 0) {
    let end = ends.pop();
    if (end === undefined) break;
    while (end > 0) {
      // Each transition examines a few small descriptors; 128 stays below 64 KiB of search work.
      if (++work % 128 === 0) await input.checkpoint();
      const candidates = tagStarts(bytes, end);
      if (candidates.starts.includes(0)) return;
      const first = candidates.starts[0];
      if (first === undefined) {
        malformed ??= candidates.malformed;
        break;
      }
      for (const alternate of candidates.starts.slice(1)) {
        if (++alternatives > MAX_METADATA_ALTERNATIVES) {
          throw new InvalidMp3Error("Too many alternative metadata chains.");
        }
        ends.push(alternate);
      }
      end = first;
    }
  }
  throw malformed ?? new InvalidMp3Error("The terminal suffix is not complete supported metadata.");
}

function tagStarts(
  bytes: Buffer,
  end: number,
): { starts: number[]; malformed: InvalidMp3Error | undefined } {
  const starts: number[] = [];
  let malformed: InvalidMp3Error | undefined;
  if (end >= APE_DESCRIPTOR_BYTES) {
    const footer = bytes.subarray(end - APE_DESCRIPTOR_BYTES, end);
    if (startsWith(footer, APE_SIGNATURE)) {
      try {
        const data = apeFooter(footer);
        const start = end - data.size - (data.paired ? APE_DESCRIPTOR_BYTES : 0);
        if (start < 0) throw new InvalidMp3Error("Invalid APE extent.");
        if (data.paired) matchApePair(bytes.subarray(start, start + APE_DESCRIPTOR_BYTES), footer);
        starts.push(start);
      } catch (error) {
        if (!(error instanceof InvalidMp3Error)) throw error;
        malformed = error;
      }
    }
  }
  if (end >= 10) {
    const footer = bytes.subarray(end - 10, end);
    if (startsWith(footer, "3DI")) {
      try {
        const extent = id3Extent(footer);
        const start = end - 10 - extent.payloadBytes - 10;
        if (footer[3] !== 4 || !extent.hasFooter || start < 0) {
          throw new InvalidMp3Error("Invalid appended ID3v2.4 extent.");
        }
        matchId3Pair(bytes.subarray(start, start + 10), footer);
        starts.push(start);
      } catch (error) {
        if (!(error instanceof InvalidMp3Error)) throw error;
        malformed = error;
      }
    }
  }
  if (end >= 128 && startsWith(bytes.subarray(end - 128, end), "TAG")) starts.push(end - 128);
  return { starts, malformed };
}

function id3Extent(header: Buffer): { payloadBytes: number; hasFooter: boolean } {
  if (header.length !== 10) throw new InvalidMp3Error("Incomplete ID3 header.");
  const major = header[3];
  const flags = header.readUInt8(5);
  const allowedFlags = major === 2 ? 0xc0 : major === 3 ? 0xe0 : major === 4 ? 0xf0 : 0;
  if (!allowedFlags || header[4] === 255 || (flags & ~allowedFlags) !== 0) {
    throw new InvalidMp3Error("Unsupported ID3 version or flags.");
  }
  let payloadBytes = 0;
  for (const byte of header.subarray(6)) {
    if (byte > 127) throw new InvalidMp3Error("ID3 length is not synchsafe.");
    payloadBytes = payloadBytes * 128 + byte;
  }
  return { payloadBytes, hasFooter: (flags & 0x10) !== 0 };
}

function matchId3Pair(header: Buffer, footer: Buffer): void {
  if (
    !startsWith(header, "ID3") ||
    !startsWith(footer, "3DI") ||
    !header.subarray(3).equals(footer.subarray(3))
  ) {
    throw new InvalidMp3Error("ID3 header and footer disagree.");
  }
}

function apeFooter(footer: Buffer): { size: number; paired: boolean } {
  if (footer.length !== APE_DESCRIPTOR_BYTES || !startsWith(footer, APE_SIGNATURE)) {
    throw new InvalidMp3Error("Incomplete APE footer.");
  }
  const version = footer.readUInt32LE(APE_VERSION_OFFSET);
  const size = footer.readUInt32LE(APE_SIZE_OFFSET);
  const flags = footer.readUInt32LE(APE_FLAGS_OFFSET);
  if (
    (version !== APE_VERSION_1 && version !== APE_VERSION_2) ||
    (version === APE_VERSION_1 && flags !== 0) ||
    size < APE_DESCRIPTOR_BYTES ||
    (flags & ~APE_ALLOWED_FOOTER_FLAGS) !== 0 ||
    footer.subarray(APE_RESERVED_OFFSET).some((byte) => byte !== 0)
  ) {
    throw new InvalidMp3Error("Invalid APE descriptor or length.");
  }
  return { size, paired: version === APE_VERSION_2 && (flags & APE_HEADER_PRESENT) !== 0 };
}

function matchApePair(header: Buffer, footer: Buffer): void {
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
