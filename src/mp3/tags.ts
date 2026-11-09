import { InvalidMp3Error } from "./error.ts";
import type { FileReader } from "./reader.ts";

/** Leading tags declare their extent; their payload must never be searched for audio. */
export async function skipId3Tags(input: FileReader): Promise<number> {
  let offset = 0;
  while (offset < input.size) {
    const header = await input.read(offset, 10);
    if (!header.subarray(0, 3).equals(Buffer.from("ID3"))) break;
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
    const end = offset + 10 + payloadBytes + (hasFooter ? 10 : 0);
    if (end > input.size) throw new InvalidMp3Error("Incomplete ID3 payload.");
    if (hasFooter) {
      const footer = await input.read(end - 10, 10);
      if (
        !footer.subarray(0, 3).equals(Buffer.from("3DI")) ||
        !footer.subarray(3).equals(header.subarray(3))
      ) {
        throw new InvalidMp3Error("ID3 header and footer disagree.");
      }
    }
    offset = end;
  }
  return offset;
}

/** Called only at an established frame boundary, so TAG-shaped audio remains audio. */
export async function isId3v1Trailer(input: FileReader, offset: number): Promise<boolean> {
  return input.size - offset === 128 && (await input.read(offset, 3)).equals(Buffer.from("TAG"));
}
