import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileReader } from "../../src/mp3/reader.ts";

/** Structural test bytes, not an independently encoded audio fixture. */
export function frame(header = "fffb9000", length = 417): Buffer {
  const bytes = Buffer.alloc(length, 0x55);
  Buffer.from(header, "hex").copy(bytes);
  return bytes;
}

export function id3(payload: Buffer = Buffer.alloc(0), version = 4, footer = false): Buffer {
  const header = Buffer.from([0x49, 0x44, 0x33, version, 0, footer ? 0x10 : 0, 0, 0, 0, 0]);
  for (let index = 0; index < 4; index++) {
    header[9 - index] = (payload.length >>> (7 * index)) & 127;
  }
  const ending = footer ? Buffer.from(header) : Buffer.alloc(0);
  if (footer) ending.write("3DI");
  return Buffer.concat([header, payload, ending]);
}

export function id3v1(): Buffer {
  const tag = Buffer.alloc(128);
  tag.write("TAG");
  return tag;
}

export function ape(payload: Buffer = Buffer.alloc(0), paired = false, version = 2000): Buffer {
  const footer = Buffer.alloc(32);
  footer.write("APETAGEX");
  footer.writeUInt32LE(version, 8);
  footer.writeUInt32LE(payload.length + 32, 12);
  footer.writeUInt32LE(paired ? 0x8000_0000 : 0, 20);
  const header = paired ? Buffer.from(footer) : Buffer.alloc(0);
  if (paired) header.writeUInt32LE(0xa000_0000, 20);
  return Buffer.concat([header, payload, footer]);
}

export async function withMp3<T>(
  bytes: Uint8Array,
  inspect: (path: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "mp3-parser-test-"));
  try {
    const path = join(directory, "input.mp3");
    await writeFile(path, bytes);
    return await inspect(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function withReader<T>(
  bytes: Uint8Array,
  inspect: (reader: FileReader) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withMp3(bytes, async (path) => {
    const file = await open(path, "r");
    try {
      return await inspect(new FileReader(file, bytes.length, signal));
    } finally {
      await file.close();
    }
  });
}
