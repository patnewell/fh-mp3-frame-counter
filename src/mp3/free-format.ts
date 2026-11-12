import { InvalidMp3Error } from "./error.ts";
import { type FrameHeader, readHeader } from "./header.ts";
import type { StreamReader } from "./reader.ts";

type FreeHeader = Extract<FrameHeader, { kind: "free" }>;
export const MAX_FREE_FRAME_BYTES = 128 * 1024;
export const MAX_INFERENCE_RUNS = 4096;
export const MAX_SEARCH_BYTES = 16 * 1024 * 1024;

/** Stream-wide counters survive every new run; ordinary indexed traversal consumes neither. */
export class InferenceBudget {
  #runs = 0;
  #positions = 0;

  begin(): void {
    if (++this.#runs > MAX_INFERENCE_RUNS) {
      throw new InvalidMp3Error("Free-format inference exceeded its run budget.");
    }
  }

  examine(): void {
    if (++this.#positions > MAX_SEARCH_BYTES) {
      throw new InvalidMp3Error("Free-format inference exceeded its search budget.");
    }
  }
}

/** Commit the earliest local boundary. Consuming its header completes the preceding free frame. */
export async function inferFreeLength(
  input: StreamReader,
  first: FreeHeader,
  budget: InferenceBudget,
): Promise<{ bytes: number; next: FreeHeader }> {
  budget.begin();
  const origin = input.position - 4;
  await input.skip(first.minimumBytes - 4);
  const headerBytes = Buffer.alloc(4);
  let word = 0;
  let filled = 0;
  while (true) {
    const view = await input.view();
    if (view.length === 0) throw new InvalidMp3Error("Cannot infer the free-format frame length.");
    for (let index = 0; index < view.length; index++) {
      word = ((word << 8) | view.readUInt8(index)) >>> 0;
      if (filled < 4) filled++;
      if (filled < 4) continue;
      const bytes = input.position + index - 3 - origin - first.padding;
      budget.examine();
      if (word >>> 21 === 0x7ff) {
        headerBytes.writeUInt32BE(word);
        const next = readHeader(headerBytes);
        if (
          next?.kind === "free" &&
          next.sampleRateHz === first.sampleRateHz &&
          bytes + next.padding >= next.minimumBytes
        ) {
          input.advance(index + 1);
          return { bytes, next };
        }
      }
      if (bytes >= MAX_FREE_FRAME_BYTES) {
        throw new InvalidMp3Error("Free-format inference exceeded its distance limit.");
      }
    }
    input.advance(view.length);
  }
}
