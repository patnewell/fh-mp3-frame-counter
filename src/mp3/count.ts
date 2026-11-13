import { InvalidMp3Error } from "./error.ts";
import { InferenceBudget, inferFreeLength } from "./free-format.ts";
import { FRAME_HEADER_BYTES, type FrameHeader, readHeader } from "./header.ts";
import { StreamReader } from "./reader.ts";
import { consumeMetadata } from "./tags.ts";

type ParsingPhase = "leading-metadata" | "audio" | "trailing-metadata";

/**
 * Count physical MPEG-1 Layer III frames from an asynchronous byte stream.
 * Audio payloads and metadata contents are skipped rather than decoded. A successful
 * count requires at least one complete frame and identifiable boundaries through
 * EOF; metadata contents are not certified as conformant.
 *
 * Consume the source once and close its iterator on success or failure.
 * Invalid/unsupported media throws InvalidMp3Error; source errors and cancellation
 * propagate. Cancellation is cooperative: source owners must interrupt blocked reads.
 */
export async function countFrames(
  source: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const input = new StreamReader(source, signal);
  let frameCount = 0;
  // Leading metadata may be followed by audio. Once trailing metadata starts,
  // all remaining bytes must be metadata; audio cannot resume.
  let phase: ParsingPhase = "leading-metadata";
  let alreadyReadHeader: FrameHeader | undefined;
  let freeFrameSize: { unpaddedBytes: number; sampleRateHz: number } | undefined;
  const inferenceBudget = new InferenceBudget();
  try {
    while (true) {
      let header = alreadyReadHeader;
      alreadyReadHeader = undefined;
      if (!header) {
        let bytes = await input.read(FRAME_HEADER_BYTES);
        if (bytes.length === 0) break;
        header = readHeader(bytes);
        if (!header || phase === "trailing-metadata") {
          // Footer-only metadata can contain header-shaped bytes. After audio
          // ends, those bytes must belong to a metadata extent instead of restarting audio.
          bytes = Buffer.from(bytes); // Metadata may outlive the producer chunk that held its prefix.
          const afterAudio = phase !== "leading-metadata";
          await consumeMetadata(input, bytes, afterAudio);
          if (afterAudio) phase = "trailing-metadata";
          continue;
        }
      }
      let frameBytes: number;
      if (header.kind === "indexed") {
        freeFrameSize = undefined;
        frameBytes = header.frameBytes;
      } else if (freeFrameSize?.sampleRateHz === header.sampleRateHz) {
        frameBytes = freeFrameSize.unpaddedBytes + header.padding;
      } else {
        const inferred = await inferFreeLength(input, header, inferenceBudget);
        freeFrameSize = {
          unpaddedBytes: inferred.unpaddedBytes,
          sampleRateHz: header.sampleRateHz,
        };
        // Inference already consumed this entire frame and the next header.
        // Count the completed frame now, then reuse that header on the next loop.
        alreadyReadHeader = inferred.nextHeader;
        frameCount++;
        phase = "audio";
        continue;
      }
      if (frameBytes < header.minimumBytes)
        throw new InvalidMp3Error("Frame length is below its overhead.");
      await input.skip(frameBytes - FRAME_HEADER_BYTES);
      frameCount++;
      phase = "audio";
    }
    signal?.throwIfAborted();
    if (frameCount === 0) throw new InvalidMp3Error("No MPEG audio frames were found.");
    return frameCount;
  } finally {
    await input.close();
  }
}
