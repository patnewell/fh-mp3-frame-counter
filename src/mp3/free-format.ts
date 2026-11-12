import { InvalidMp3Error } from "./error.ts";
import { type FrameHeader, readHeader } from "./header.ts";
import { type FileReader, READ_WINDOW_BYTES } from "./reader.ts";

type FreeHeader = Extract<FrameHeader, { kind: "free" }>;

/**
 * Resume scanning at cursor, the next unexamined header position after any selected boundary.
 * Numeric checkpoints permit retries without retaining a read window per candidate.
 */
export interface CandidateScan {
  readonly origin: number;
  readonly first: FreeHeader;
  cursor: number;
}

export function candidateScan(origin: number, first: FreeHeader): CandidateScan {
  return { origin, first, cursor: origin + first.minimumBytes };
}

/** This bounds charged framing work, not all metadata work or physical disk I/O. */
export class FramingBudget {
  #remainingBytes: number;
  #remainingCandidates = 4096;

  constructor(fileBytes: number) {
    this.#remainingBytes = Math.min(Number.MAX_SAFE_INTEGER, fileBytes * 8);
  }

  get exhausted(): boolean {
    return this.#remainingBytes < 0 || this.#remainingCandidates < 0;
  }

  visit(bytes: number): void {
    this.#remainingBytes -= bytes;
    if (this.#remainingBytes < 0)
      throw new InvalidMp3Error("Framing search exceeded its work budget.");
  }

  select(): void {
    if (--this.#remainingCandidates < 0) {
      throw new InvalidMp3Error("Framing search exceeded its candidate budget.");
    }
  }
}

/** Return the next possible unpadded length; the caller must validate the full continuation. */
export async function nextFreeLength(
  input: FileReader,
  scan: CandidateScan,
  budget: FramingBudget,
): Promise<number | undefined> {
  while (scan.cursor + 4 <= input.size) {
    const window = await input.read(
      scan.cursor,
      Math.min(READ_WINDOW_BYTES, input.size - scan.cursor),
    );
    if (window.length < 4) return undefined;
    for (let index = 0; index + 4 <= window.length; index++) {
      if (window[index] !== 0xff) continue;
      const header = readHeader(window.subarray(index, index + 4));
      if (header?.kind !== "free" || header.sampleRateHz !== scan.first.sampleRateHz) continue;
      const unpadded = scan.cursor + index - scan.origin - scan.first.padding;
      const nextBytes = unpadded + header.padding;
      if (nextBytes < header.minimumBytes || scan.cursor + index + nextBytes > input.size) continue;
      budget.visit(index + 1);
      budget.select();
      scan.cursor += index + 1;
      return unpadded;
    }
    // A header can straddle two windows; retain the three overlapping positions.
    const examined = window.length - 3;
    budget.visit(examined);
    scan.cursor += examined;
  }
  return undefined;
}
