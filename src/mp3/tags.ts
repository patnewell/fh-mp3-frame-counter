import { InvalidMp3Error } from "./error.ts";
import type { FileReader } from "./reader.ts";

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
    const prefix = await input.read(offset, 32);
    if (startsWith(prefix, "ID3")) {
      const header = prefix.subarray(0, 10);
      const extent = id3Extent(header);
      const end = offset + extent.bytes;
      if (end > input.size) throw new InvalidMp3Error("Incomplete ID3 payload.");
      if (extent.hasFooter) matchId3Pair(header, await input.read(end - 10, 10));
      offset = end;
    } else if (startsWith(prefix, "APETAGEX")) {
      if (
        prefix.length !== 32 ||
        prefix.readUInt32LE(8) !== 2000 ||
        prefix.readUInt32LE(20) >>> 29 !== 5
      ) {
        throw new InvalidMp3Error("Leading APEv2 requires a header and matching footer.");
      }
      const end = offset + 32 + prefix.readUInt32LE(12);
      if (end > input.size || end < offset + 64) throw new InvalidMp3Error("Invalid APE extent.");
      if ((await apeStart(input, await input.read(end - 32, 32), offset, end)) !== offset) {
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
  if (end - boundary >= 32) {
    const footer = await input.read(end - 32, 32);
    if (startsWith(footer, "APETAGEX")) {
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
  if (footer.length !== 32 || !startsWith(footer, "APETAGEX"))
    throw new InvalidMp3Error("Incomplete APE footer.");
  const version = footer.readUInt32LE(8);
  const size = footer.readUInt32LE(12);
  const flags = footer.readUInt32LE(20);
  const paired = (flags & 0x8000_0000) !== 0;
  const start = end - size - (paired ? 32 : 0);
  if (
    (version !== 1000 && version !== 2000) ||
    size < 32 ||
    start < boundary ||
    (flags & 0x7fff_fffe) !== 0 ||
    footer.subarray(24).some((byte) => byte !== 0)
  ) {
    throw new InvalidMp3Error("Invalid APE descriptor or length.");
  }
  if (paired) {
    const header = await input.read(start, 32);
    if (
      header.length !== 32 ||
      !header.subarray(0, 20).equals(footer.subarray(0, 20)) ||
      header.readUInt32LE(20) !== (flags | 0x2000_0000) >>> 0 ||
      !header.subarray(24).equals(footer.subarray(24))
    ) {
      throw new InvalidMp3Error("APE header and footer disagree.");
    }
  }
  return start;
}

function startsWith(bytes: Buffer, text: string): boolean {
  return bytes.subarray(0, text.length).equals(Buffer.from(text));
}
