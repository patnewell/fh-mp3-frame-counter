import { InvalidMp3Error } from "./error.ts";
import { InferenceBudget, inferFreeLength } from "./free-format.ts";
import { type FrameHeader, readHeader } from "./header.ts";
import { StreamReader } from "./reader.ts";
import { readTag } from "./tags.ts";

/** Consume a byte stream with bounded retained state; a successful count requires valid EOF. */
export async function countFrames(
  source: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const input = new StreamReader(source, signal);
  let count = 0;
  let terminal = false;
  let pendingHeader: FrameHeader | undefined;
  let freeLength: { bytes: number; sampleRateHz: number } | undefined;
  const budget = new InferenceBudget();
  try {
    while (true) {
      let header = pendingHeader;
      pendingHeader = undefined;
      if (!header) {
        let bytes = await input.read(4);
        if (bytes.length === 0) break;
        header = readHeader(bytes);
        if (!header || terminal) {
          // After a terminal envelope, header-shaped bytes may be an undeclared APE body,
          // but they can never resume audio counting. The bounded suffix validator decides.
          bytes = Buffer.from(bytes); // Metadata may outlive the producer chunk that held its prefix.
          if ((await readTag(input, bytes, count > 0)) === "eof") break;
          if (count > 0) terminal = true;
          continue;
        }
      }
      let length: number;
      if (header.kind === "indexed") {
        freeLength = undefined;
        length = header.frameBytes;
      } else if (freeLength?.sampleRateHz === header.sampleRateHz) {
        length = freeLength.bytes + header.padding;
      } else {
        const inferred = await inferFreeLength(input, header, budget);
        freeLength = { bytes: inferred.bytes, sampleRateHz: header.sampleRateHz };
        pendingHeader = inferred.next;
        count++;
        continue;
      }
      if (length < header.minimumBytes)
        throw new InvalidMp3Error("Frame length is below its overhead.");
      await input.skip(length - 4);
      count++;
    }
    signal?.throwIfAborted();
    if (count === 0) throw new InvalidMp3Error("No MPEG audio frames were found.");
    return count;
  } finally {
    await input.close();
  }
}
