import { InvalidMp3Error } from "./error.ts";
import { FRAME_HEADER_BYTES, type FrameHeader, readHeader } from "./header.ts";
import type { StreamReader } from "./reader.ts";

/** A decoded header with bitrate index zero; its frame size must be inferred. */
type FreeHeader = Extract<FrameHeader, { kind: "free" }>;
// Keep the shared width local to this module's per-byte scanning loop.
const HEADER_BYTES = FRAME_HEADER_BYTES;

// Streaming keeps memory use small, but searching a long or misleading input can
// still use excessive CPU. These limits bound the extra work needed to discover
// frame sizes. They are service policy, so some otherwise valid MPEG layouts may
// be rejected. They do not impose a total upload-size limit.

// Bound one search: stop looking when the inferred frame would exceed 128 KiB
// without padding. A missing next header must not trigger a scan of the whole file.
export const MAX_UNPADDED_FRAME_BYTES = 128 * 1024;

// Bound restarts: input that repeatedly changes framing must not trigger an
// unlimited number of searches, even when each search is short.
export const MAX_INFERENCE_RUNS = 4096;

// Bound combined search work: many searches below the distance limit can still
// be expensive. Count every possible header position examined across the stream;
// this is a work allowance, not a 16 MiB buffer or a limit on total file bytes.
export const MAX_SEARCH_POSITIONS = 16 * 1024 * 1024;

/**
 * A run is a sequence of free-format frames sharing one base frame size.
 * Once that size is known, later frames reuse it without another search. In
 * count.ts, an intervening indexed-bitrate frame or a sample-rate change means
 * another size search is needed when free-format counting resumes.
 *
 * Keep these counters for the whole stream. Resetting them for each run would
 * let repeated restarts bypass the limits. Frames whose size can be calculated
 * directly from their bitrate do not spend this search allowance.
 */
export class InferenceBudget {
  #inferenceRuns = 0;
  #candidatePositions = 0;

  /** Charge one new frame-size search, rather than charging every frame counted. */
  beginRun(): void {
    if (++this.#inferenceRuns > MAX_INFERENCE_RUNS) {
      throw new InvalidMp3Error("Free-format inference exceeded its run budget.");
    }
  }

  /** Charge every examined position, including bytes that do not form a header. */
  examineCandidate(): void {
    if (++this.#candidatePositions > MAX_SEARCH_POSITIONS) {
      throw new InvalidMp3Error("Free-format inference exceeded its search budget.");
    }
  }
}

/**
 * Work out a free-format frame's size by measuring the distance to the next
 * plausible frame header.
 *
 * Normal MP3 headers identify a bitrate that lets us calculate the frame size.
 * Free-format headers have bitrate index zero, leaving that bitrate unspecified,
 * so we measure the first frame instead.
 *
 * For example, suppose frame A's header starts at byte 0 and frame B's header
 * starts at byte 501. A therefore occupies 501 bytes, including its header.
 * If A's padding flag is 1, one of those bytes is padding: the base frame size
 * is 501 - 1 = 500 bytes. Following frames in this run occupy either 500 or 501
 * bytes, depending on their own padding flag (0 or 1).
 *
 * The caller has already read A's header before calling this function. Finding B
 * requires reading B's four-byte header too. We return the base frame size and
 * B's decoded header so the caller can continue processing B without reading its
 * header again. B's remaining contents have not yet been consumed by the counter.
 *
 * This parser accepts the first plausible matching free-format header. If later
 * frames do not line up with that choice, it rejects the file instead of going
 * back and trying another interpretation. A failure can happen much later;
 * retrying earlier choices could require retaining arbitrarily much input,
 * defeating the bounded-memory streaming design.
 */
export async function inferFreeLength(
  input: StreamReader,
  firstHeader: FreeHeader,
  budget: InferenceBudget,
): Promise<{ unpaddedBytes: number; nextHeader: FreeHeader }> {
  budget.beginRun();
  const firstHeaderStart = input.position - HEADER_BYTES;

  // The first frame must contain its header, any CRC (an error-checking value),
  // and channel-specific decoding information (MPEG calls this "side information").
  // Bytes inside that required area cannot start the next frame.
  // minimumBytes includes the already-read header,
  // so subtract its four bytes from the amount left to skip.
  await input.skip(firstHeader.minimumBytes - HEADER_BYTES);

  // Input chunks can end halfway through a header. Keep the window across chunks
  // so all four header bytes can still be recognised when more input arrives.
  const window = new HeaderWindow();
  while (true) {
    // Scan a bounded block at a time. When we request another block, StreamReader
    // checks cancellation and periodically lets timers and other tasks run, so a
    // long search cannot monopolise the event loop.
    const view = await input.view();
    if (view.length === 0) throw new InvalidMp3Error("Cannot infer the free-format frame length.");
    for (let byteOffset = 0; byteOffset < view.length; byteOffset++) {
      const candidateHeader = window.append(view.readUInt8(byteOffset));
      if (!window.isFull) continue;

      // input.position is still at this block's start. Add our offset to locate
      // the byte just after the candidate header, then step back four bytes to
      // find its start. The distance between header starts is the first frame's
      // complete size; removing its padding gives the size to reuse in this run.
      const candidateHeaderEnd = input.position + byteOffset + 1;
      const candidateHeaderStart = candidateHeaderEnd - HEADER_BYTES;
      const paddedFrameBytes = candidateHeaderStart - firstHeaderStart;
      const unpaddedFrameBytes = paddedFrameBytes - firstHeader.padding;
      budget.examineCandidate();

      if (isCompatibleFreeHeader(candidateHeader, firstHeader, unpaddedFrameBytes)) {
        // Consume through the next header, leaving its body for the caller.
        input.advance(byteOffset + 1);
        return { unpaddedBytes: unpaddedFrameBytes, nextHeader: candidateHeader };
      }

      // No acceptable header was found within this search's allowance. Check
      // after accepting candidates so a header exactly at the limit still works.
      if (unpaddedFrameBytes >= MAX_UNPADDED_FRAME_BYTES) {
        throw new InvalidMp3Error("Free-format inference exceeded its distance limit.");
      }
    }
    // All bytes in this block have been examined. Consume them before requesting
    // another block; the window preserves the trailing bytes needed across blocks.
    input.advance(view.length);
  }
}

/**
 * Only another free-format header at the same sample rate can establish this
 * run's size. A rate change is handled as a separate run by count.ts.
 * Channel mode and CRC use may differ, so the next frame must fit its own
 * required structure as well as matching the current run.
 */
function isCompatibleFreeHeader(
  candidate: FrameHeader | undefined,
  first: FreeHeader,
  unpaddedFrameBytes: number,
): candidate is FreeHeader {
  return (
    candidate?.kind === "free" &&
    candidate.sampleRateHz === first.sampleRateHz &&
    // Base size + the next frame's padding is its total size. It must leave room
    // for that frame's header, any CRC and its channel-specific decoding data.
    unpaddedFrameBytes + candidate.padding >= candidate.minimumBytes
  );
}

/**
 * Remember the four most recent bytes as one 32-bit number, oldest byte first.
 * Keeping that number across input chunks allows a header to span chunks.
 * Bit operations avoid allocating or copying a buffer at every search position;
 * the reusable four-byte buffer is filled only when a header looks plausible.
 */
class HeaderWindow {
  #word = 0;
  #byteCount = 0;
  readonly #bytes = Buffer.alloc(HEADER_BYTES);

  get isFull(): boolean {
    return this.#byteCount === HEADER_BYTES;
  }

  append(byte: number): FrameHeader | undefined {
    // Shift by eight bits to discard the oldest byte, then append the new byte.
    // >>> 0 keeps the result unsigned: writeUInt32BE expects a nonnegative value.
    this.#word = ((this.#word << 8) | byte) >>> 0;
    if (!this.isFull) this.#byteCount++;

    // An MPEG header begins with 11 one-bits called "sync bits". Shifting away
    // the other 21 bits leaves this marker; 0x7ff is eleven one-bits in hex.
    // Audio payload can contain the same pattern, so readHeader must still check
    // the remaining header fields. Fewer than four input bytes cannot form a header.
    const hasSyncBits = this.#word >>> 21 === 0x7ff;
    if (!this.isFull || !hasSyncBits) return undefined;

    this.#bytes.writeUInt32BE(this.#word);
    return readHeader(this.#bytes);
  }
}
