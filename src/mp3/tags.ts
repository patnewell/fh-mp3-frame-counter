import { InvalidMp3Error } from "./error.ts";
import type { FileReader } from "./reader.ts";

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
const APE_READ_ONLY = 0x0000_0001;
const APE_DESCRIPTOR_ROLE_MASK = APE_HEADER_PRESENT | APE_FOOTER_ABSENT | APE_IS_HEADER;
// Buffer flag reads are unsigned; normalize combined flags before comparing them.
const APE_PAIRED_HEADER_FLAGS = (APE_HEADER_PRESENT | APE_IS_HEADER) >>> 0;
const APE_ALLOWED_FOOTER_FLAGS = APE_HEADER_PRESENT | APE_READ_ONLY;

/** Owned by one parse, so repeated suffix checks cannot reset their ambiguity allowance. */
export class MetadataBudget {
  #alternatives = 4096;

  get exhausted(): boolean {
    return this.#alternatives < 0;
  }

  fork(): void {
    if (--this.#alternatives < 0)
      throw new InvalidMp3Error("Too many alternative metadata chains.");
  }
}

/** Declared leading envelopes can be skipped without interpreting their item contents. */
export async function skipLeadingTags(input: FileReader): Promise<number> {
  let offset = 0;
  while (offset < input.size) {
    const prefix = await input.read(offset, APE_DESCRIPTOR_BYTES);
    if (startsWith(prefix, "ID3")) {
      const header = prefix.subarray(0, 10);
      const extent = id3Extent(header);
      const end = offset + extent.bytes;
      if (end > input.size) throw new InvalidMp3Error("Incomplete ID3 payload.");
      if (extent.hasFooter) matchId3Pair(header, await input.read(end - 10, 10));
      offset = end;
    } else if (startsWith(prefix, APE_SIGNATURE)) {
      if (
        prefix.length !== APE_DESCRIPTOR_BYTES ||
        prefix.readUInt32LE(APE_VERSION_OFFSET) !== APE_VERSION_2 ||
        (prefix.readUInt32LE(APE_FLAGS_OFFSET) & APE_DESCRIPTOR_ROLE_MASK) >>> 0 !==
          APE_PAIRED_HEADER_FLAGS
      ) {
        throw new InvalidMp3Error("Leading APEv2 requires a header and matching footer.");
      }
      const end = offset + APE_DESCRIPTOR_BYTES + prefix.readUInt32LE(APE_SIZE_OFFSET);
      if (end > input.size || end < offset + 2 * APE_DESCRIPTOR_BYTES)
        throw new InvalidMp3Error("Invalid APE extent.");
      const footer = await input.read(end - APE_DESCRIPTOR_BYTES, APE_DESCRIPTOR_BYTES);
      if ((await apeStart(input, footer, offset, end)) !== offset) {
        throw new InvalidMp3Error("APE header and footer lengths disagree.");
      }
      offset = end;
    } else {
      break;
    }
  }
  return offset;
}

/** Examine complete suffixes only after traversal has established an audio boundary. */
export async function isTagSuffix(
  input: FileReader,
  boundary: number,
  budget: MetadataBudget,
): Promise<boolean> {
  const remainingEnds = [input.size];
  let malformed: InvalidMp3Error | undefined;
  while (remainingEnds.length > 0) {
    let end = remainingEnds.pop();
    if (end === undefined) break;
    while (end > boundary) {
      const preceding = await tagStarts(input, boundary, end);
      if (preceding.starts.includes(boundary)) return true;
      const first = preceding.starts[0];
      if (first === undefined) {
        malformed ??= preceding.malformed;
        break;
      }
      for (const alternate of preceding.starts.slice(1)) {
        budget.fork();
        remainingEnds.push(alternate);
      }
      end = first;
    }
  }
  if (malformed) throw malformed;
  return false;
}

async function tagStarts(
  input: FileReader,
  boundary: number,
  end: number,
): Promise<{ starts: number[]; malformed: InvalidMp3Error | undefined }> {
  const starts: number[] = [];
  let malformed: InvalidMp3Error | undefined;
  if (end - boundary >= APE_DESCRIPTOR_BYTES) {
    const footer = await input.read(end - APE_DESCRIPTOR_BYTES, APE_DESCRIPTOR_BYTES);
    if (startsWith(footer, APE_SIGNATURE)) {
      try {
        starts.push(await apeStart(input, footer, boundary, end));
      } catch (error) {
        if (!(error instanceof InvalidMp3Error)) throw error;
        malformed = error;
      }
    }
  }
  if (end - boundary >= 10) {
    const footer = await input.read(end - 10, 10);
    if (startsWith(footer, "3DI")) {
      try {
        const extent = id3Extent(footer);
        const start = end - extent.bytes;
        if (footer[3] !== 4 || !extent.hasFooter || start < boundary) {
          throw new InvalidMp3Error("Invalid appended ID3v2.4 extent.");
        }
        matchId3Pair(await input.read(start, 10), footer);
        starts.push(start);
      } catch (error) {
        if (!(error instanceof InvalidMp3Error)) throw error;
        malformed = error;
      }
    }
  }
  if (end - boundary >= 128 && startsWith(await input.read(end - 128, 3), "TAG")) {
    starts.push(end - 128);
  }
  return { starts, malformed };
}

function id3Extent(header: Buffer): { bytes: number; hasFooter: boolean } {
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
  const hasFooter = (flags & 0x10) !== 0;
  return { bytes: 10 + payloadBytes + (hasFooter ? 10 : 0), hasFooter };
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

async function apeStart(
  input: FileReader,
  footer: Buffer,
  boundary: number,
  end: number,
): Promise<number> {
  if (footer.length !== APE_DESCRIPTOR_BYTES || !startsWith(footer, APE_SIGNATURE))
    throw new InvalidMp3Error("Incomplete APE footer.");
  const version = footer.readUInt32LE(APE_VERSION_OFFSET);
  const size = footer.readUInt32LE(APE_SIZE_OFFSET);
  const flags = footer.readUInt32LE(APE_FLAGS_OFFSET);
  // Only APEv2 defines header-present flags; this service requires zero flags for v1.
  const paired = version === APE_VERSION_2 && (flags & APE_HEADER_PRESENT) !== 0;
  const start = end - size - (paired ? APE_DESCRIPTOR_BYTES : 0);
  if (
    (version !== APE_VERSION_1 && version !== APE_VERSION_2) ||
    (version === APE_VERSION_1 && flags !== 0) ||
    size < APE_DESCRIPTOR_BYTES ||
    start < boundary ||
    (flags & ~APE_ALLOWED_FOOTER_FLAGS) !== 0 ||
    footer.subarray(APE_RESERVED_OFFSET).some((byte) => byte !== 0)
  ) {
    throw new InvalidMp3Error("Invalid APE descriptor or length.");
  }
  if (paired) {
    const header = await input.read(start, APE_DESCRIPTOR_BYTES);
    if (
      header.length !== APE_DESCRIPTOR_BYTES ||
      !header.subarray(0, APE_FLAGS_OFFSET).equals(footer.subarray(0, APE_FLAGS_OFFSET)) ||
      header.readUInt32LE(APE_FLAGS_OFFSET) !== (flags | APE_IS_HEADER) >>> 0 ||
      !header.subarray(APE_RESERVED_OFFSET).equals(footer.subarray(APE_RESERVED_OFFSET))
    ) {
      throw new InvalidMp3Error("APE header and footer disagree.");
    }
  }
  return start;
}

function startsWith(bytes: Buffer, text: string): boolean {
  return bytes.subarray(0, text.length).equals(Buffer.from(text));
}
