import { open } from "node:fs/promises";
import { InvalidMp3Error } from "./error.ts";
import { readHeader } from "./header.ts";
import { FileReader } from "./reader.ts";
import { isId3v1Trailer, skipId3Tags } from "./tags.ts";

/** Count physical frames in a completed, unchanged file; own and close its descriptor. */
export async function countFrames(path: string, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const file = await open(path, "r");
  try {
    const input = new FileReader(file, (await file.stat()).size, signal);
    let offset = await skipId3Tags(input);
    let count = 0;
    while (offset < input.size) {
      const header = readHeader(await input.read(offset, 4));
      if (!header) {
        if (await isId3v1Trailer(input, offset)) break;
        throw new InvalidMp3Error(`Invalid or unsupported MPEG frame at byte ${offset}.`);
      }
      if (offset + header.frameBytes > input.size) {
        throw new InvalidMp3Error(`Incomplete MPEG frame at byte ${offset}.`);
      }
      offset += header.frameBytes;
      count++;
    }
    signal?.throwIfAborted();
    if (count === 0) throw new InvalidMp3Error("No MPEG audio frames were found.");
    return count;
  } finally {
    await file.close();
  }
}
