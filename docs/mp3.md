# MP3 framing for this assignment

An MP3 file contains compressed MPEG audio frames, often surrounded by metadata.
This service counts **physical MPEG-1 Layer III frames**. It does not decode audio,
estimate from duration, or trust a count advertised in a metadata header.

## Header and indexed length

Each frame starts with a four-byte header. The relevant fields are:

| Bits, from most significant | Meaning for counting                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| 31–21                       | Eleven synchronization bits, all 1                                         |
| 20–19                       | MPEG version; `11` means MPEG-1                                            |
| 18–17                       | Layer; `01` means Layer III                                                |
| 16                          | Protection flag; zero adds a two-byte CRC after the header                 |
| 15–12                       | Bitrate index; 1–14 select 32–320 kb/s, 0 means free-format, 15 is invalid |
| 11–10                       | Sample rate: 44.1, 48 or 32 kHz; the reserved value is rejected            |
| 9                           | Padding adds one byte to the frame                                         |
| 7–6                         | Channel mode; mono changes the side-information overhead                   |
| 1–0                         | Emphasis; the reserved value is rejected                                   |

For an indexed MPEG-1 Layer III frame, length in bytes is
`floor(144000 × bitrateKbps / sampleRateHz) + padding`. That length includes the
header, optional CRC, side information and compressed data. VBR changes the
bitrate between frames; calculate every length independently. Start the next
header at the established boundary. A sync-shaped payload is not another frame.

MPEG-1 Layer III represents 1,152 samples per frame, but duration and decoder
packet totals are not reliable substitutes for walking physical frames. The bit
reservoir can refer to earlier frame data; framing alone does not decode it.

## Free-format ambiguity

Bitrate index zero does not supply a length. Search for compatible boundaries to
infer an unpadded length, accounting for each frame's padding. A sample-rate
change requires a fresh inference. Check minimum header/CRC/side-information
overhead and reject a lone frame whose length cannot be established.

A plausible nearby sync pattern is only a candidate. Validate the complete
remaining layout, including its terminal metadata, before accepting it. If a
candidate fails later, retry a saved alternative. If multiple complete layouts
are structurally valid, search candidate offsets in ascending order and retry saved choices depth-first. This is an explicit
ambiguity policy, not proof of a unique decoded interpretation.

Each checkpoint in `src/mp3/count.ts` saves the frame count immediately before
the frame at `scan.origin`. Its mutable `scan.cursor` points beyond the last
selected candidate boundary. On a later layout failure, `retryCheckpoint()`
tries the newest checkpoint first, restores its original offset/count with the
next inferred length, and pops it only when its scan has no candidates left.
The advanced cursor prevents repeating a rejected choice. Both framing and
metadata budgets remain shared across retries; restoring traversal state never
refunds work already charged. I/O errors, cancellation and exhausted budgets
propagate without trying another layout.

The parser permits at most **4,096 candidate selections** and charges candidate
scan positions plus traversed frame extents against **8 × file size**, including
retries. Budget exhaustion rejects the file instead of returning a partial
count. These are framing-search limits, not measurements of physical disk reads
or all metadata work. One 64 KiB file window and numeric checkpoints keep retained
data bounded; a checkpoint must not retain its own scan buffer.

## Metadata at established boundaries

Leading ID3v2 envelopes declare a synchsafe size: the high bit of each size byte
is zero. Validate supported versions, flags and envelope length; an ID3v2.4
footer must match its header. Leading paired APEv2 is also supported.

After a frame, the remaining suffix may consist entirely of recognized metadata:

| Envelope         | Structural checks                                                                       |
| ---------------- | --------------------------------------------------------------------------------------- |
| ID3v1            | Exactly 128 bytes beginning with `TAG`                                                  |
| APEv1/v2         | Descriptor version, size, flags, reserved fields and any required header/footer pairing |
| Appended ID3v2.4 | Valid paired header/footer with matching size and flags                                 |

Traverse stacked terminal tags iteratively. When descriptors overlap, retain
alternative ends and accept a complete valid chain. Limit alternative
interpretations to 4,096 across the file, including repeated suffix checks; an ordinary unambiguous chain has no artificial depth
cap. Frame traversal takes precedence over speculative tag trimming: tag-like
bytes inside an otherwise complete frame remain audio.

Primary format references: [ID3v2.4 structure](https://id3.org/id3v2.4.0-structure)
and [APEv2 specification](https://wiki.hydrogenaudio.org/index.php?title=APEv2_specification).
The implementation validates envelopes needed for traversal, not every metadata
item or its semantic content.

APEv1 has no header. This service uses strict zero-only flags for its footer;
it does not reinterpret APEv2's header-present flag as a v1 pairing rule. The
[format specification bundled by TagLib](https://github.com/taglib/taglib/blob/master/taglib/ape/ape-tag-format.txt)
also describes permissive readers that ignore v1 flags; this service intentionally
rejects nonzero v1 flags instead.

## Physical carriers and independent expectations

Xing/Info metadata can occupy a genuine MPEG frame. Count that physical carrier
even when a decoder omits it from its audio-packet list. The unchanged assignment
sample has 6,089 decoder packets plus one Xing carrier, yielding **6,090**.
The VBR fixture similarly has 22 packets plus one carrier. The real free-format
fixture has 22 frames at 1,200-byte intervals.

The [fixture guide](../tests/fixtures/README.md) records hashes, offsets, tool
evidence and its limits. Tests supplement those assets with synthetic byte
vectors for precise malformed headers, ambiguity and tag-payload lookalikes.

## Deliberate limits

MPEG-2, MPEG-2.5 and other layers are outside this service. Reject incomplete
frames/tags, reserved headers, intervening junk, unsupported framing and no-frame
input. Never return a partial successful count. A structurally plausible file may
still contain invalid compressed samples, incorrect CRC values or invalid
metadata items. This is structural counting, not decoding or malware inspection.
