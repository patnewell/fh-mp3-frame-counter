import { open } from "node:fs/promises";
import { InvalidMp3Error } from "./error.ts";
import { type CandidateScan, candidateScan, FramingBudget, nextFreeLength } from "./free-format.ts";
import { readHeader } from "./header.ts";
import { FileReader } from "./reader.ts";
import { isTagSuffix, MetadataBudget, skipLeadingTags } from "./tags.ts";

interface FreeLength {
  readonly bytes: number;
  readonly sampleRateHz: number;
}

interface Checkpoint {
  readonly scan: CandidateScan;
  readonly count: number;
}

/** Count physical frames in a completed, unchanged file; own and close its descriptor. */
export async function countFrames(path: string, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const file = await open(path, "r");
  try {
    const input = new FileReader(file, (await file.stat()).size, signal);
    let offset = await skipLeadingTags(input);
    let count = 0;
    let freeLength: FreeLength | undefined;
    const checkpoints: Checkpoint[] = [];
    const budget = new FramingBudget(input.size);
    const metadataBudget = new MetadataBudget();
    while (offset < input.size) {
      try {
        const header = readHeader(await input.read(offset, 4));
        if (!header) {
          if (await isTagSuffix(input, offset, metadataBudget)) break;
          throw new InvalidMp3Error(`Invalid or unsupported MPEG frame at byte ${offset}.`);
        }
        let length: number;
        if (header.kind === "indexed") {
          freeLength = undefined;
          length = header.frameBytes;
        } else {
          if (freeLength?.sampleRateHz !== header.sampleRateHz) {
            const scan = candidateScan(offset, header);
            const bytes = await nextFreeLength(input, scan, budget);
            if (bytes === undefined)
              throw new InvalidMp3Error("Cannot infer the free-format frame length.");
            checkpoints.push({ scan, count });
            freeLength = { bytes, sampleRateHz: header.sampleRateHz };
          }
          length = freeLength.bytes + header.padding;
        }
        if (length < header.minimumBytes || offset + length > input.size) {
          throw new InvalidMp3Error(`Incomplete MPEG frame at byte ${offset}.`);
        }
        budget.visit(length);
        offset += length;
        count++;
      } catch (error) {
        if (!(error instanceof InvalidMp3Error) || budget.exhausted || metadataBudget.exhausted) {
          throw error;
        }
        // An attractive early header can be payload. Retry until the entire layout validates.
        const alternative = await retryCheckpoint(input, checkpoints, budget);
        if (!alternative) throw error;
        offset = alternative.offset;
        count = alternative.count;
        freeLength = alternative.length;
      }
    }
    signal?.throwIfAborted();
    if (count === 0) throw new InvalidMp3Error("No MPEG audio frames were found.");
    return count;
  } finally {
    await file.close();
  }
}

async function retryCheckpoint(
  input: FileReader,
  checkpoints: Checkpoint[],
  budget: FramingBudget,
): Promise<{ offset: number; count: number; length: FreeLength } | undefined> {
  while (checkpoints.length > 0) {
    const checkpoint = checkpoints.at(-1);
    if (!checkpoint) return undefined;
    const bytes = await nextFreeLength(input, checkpoint.scan, budget);
    if (bytes !== undefined) {
      return {
        offset: checkpoint.scan.origin,
        count: checkpoint.count,
        length: { bytes, sampleRateHz: checkpoint.scan.first.sampleRateHz },
      };
    }
    checkpoints.pop();
  }
  return undefined;
}
