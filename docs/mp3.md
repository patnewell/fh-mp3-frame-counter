# MP3 framing for this assignment

The service counts **physical MPEG-1 Layer III frames** from incoming bytes.
It does not decode audio, estimate duration, or trust advertised frame totals.

## Header and indexed length

Each frame starts with a four-byte header, assembled across arbitrary source
chunk boundaries. The relevant fields are:

| Bits, most significant first | Meaning                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| 31–21                        | Eleven synchronization bits, all 1                                         |
| 20–19                        | MPEG version; `11` selects MPEG-1                                          |
| 18–17                        | Layer; `01` selects Layer III                                              |
| 16                           | Protection flag; zero adds two CRC bytes                                   |
| 15–12                        | Bitrate index; 1–14 select 32–320 kb/s, 0 means free-format, 15 is invalid |
| 11–10                        | Sample rate: 44.1, 48 or 32 kHz; reserved value rejected                   |
| 9                            | One padding byte when set                                                  |
| 7–6                          | Channel mode; mono changes side-information overhead                       |
| 1–0                          | Emphasis; reserved value rejected                                          |

Indexed frame length is `floor(144000 × bitrateKbps / sampleRateHz) + padding`.
It includes the header, CRC where present, side information and compressed data.
CBR and ordinary VBR use this calculation for every frame. VBR changes bitrate
between frames; the current header still supplies the next boundary, so seeking
is unnecessary. The parser consumes payload in bulk without inspecting it for
sync/tag patterns, then increments only after the complete frame has arrived.
An incomplete header or payload at EOF is invalid.

MPEG-1 Layer III represents 1152 samples per frame. Duration and decoder packet
totals are not substitutes for walking physical framing; bit-reservoir contents
and CRC values are not decoded or validated.

## Forward-only free-format inference

Bitrate index zero supplies no indexed length. Starting after minimum framing
overhead, search forward for the first compatible same-rate free header. Infer
an unpadded length accounting for the first header's padding and both headers'
minimum overhead. Commit that local length; each subsequent free frame adds its
own padding. An indexed frame or sample-rate change starts a new inference.
A lone unresolved free frame is invalid.

For example, suppose header A has padding set and header B begins 501 bytes
after A. The common **unpadded** length is `501 - 1 = 500` bytes. A occupies
501 bytes; B occupies `500 + B.padding` bytes. The distance includes A's header
and all of its payload, but excludes B's header.

The implementation follows that calculation in `src/mp3/free-format.ts`:

1. Remember where A started. Its four-byte header has already been consumed.
2. Skip A's mandatory framing overhead: any CRC and channel side information.
3. Slide a four-byte window through the remaining bytes until it contains a
   supported free-format header at the same sample rate. A window can span chunks.
4. Subtract A's padding from the distance to that candidate. Check that this
   length also leaves room for B's own framing overhead and padding.
5. Return the unpadded length and B's decoded header. The counter now knows A is
   complete; it reuses B's header instead of reading it again.

`HeaderWindow` contains the byte-scanning mechanics; `isCompatibleFreeHeader`
contains the MPEG compatibility checks. `InferenceBudget` counts searches and
examined positions across the whole stream, including later free-format runs.

The concrete bounds are:

- Maximum unpadded inferred length: **128 KiB**.
- Inference runs: **4096 per stream**.
- Charged candidate positions: **16 MiB per stream**.

Limits apply while bytes arrive, independent of total file length. Ordinary
indexed traversal does not consume the inference-search budget. Searches run in
bounded synchronous windows, check cancellation and yield to the event loop at
least every 64 KiB of byte progress.

This replaces 002's complete-suffix/depth-first retry policy. For example, a
500-byte frame containing compatible headers at offsets 100 and 200 can lure a
100-byte interpretation that fails later. The seek parser could rewind and try
500; the streaming parser rejects after its local choice fails. Retaining every
possible retry until EOF would defeat a fixed memory bound. The unchanged real
free-format fixture's first compatible boundary is 1200 bytes and still yields
22 frames. The [005 matrix](../specs/005-incremental-mp3-parsing/spec.md#compatibility-matrix)
records all superseded synthetic expectations.

## Metadata at established boundaries

Metadata is skipped to locate audio, rather than checked for full conformance.
An ID3v2.2/2.3/2.4 header declares a synchsafe body length. Read the supported
major version and length, then skip the body incrementally. In v2.4 only, the
footer flag adds ten more bytes. A paired APEv2 header supplies its own extent
in the same way. No large declared body needs to be retained.

After audio, recognized forward envelopes take ownership of their whole extent:

| Envelope        | Forward treatment                                                            |
| --------------- | ---------------------------------------------------------------------------- |
| ID3v1           | Consume exactly 128 bytes beginning with `TAG`                               |
| Paired APEv2    | Read the supported header layout and skip its declared size including footer |
| ID3v2.2/2.3/2.4 | Skip the declared body and any footer indicated by a v2.4 header             |

ID3 revision numbers and unrelated flags, APE item counts, reserved bytes and
read-only flags do not locate frames, so they are ignored. A forward header's
size determines which bytes to skip; its footer is not compared or inspected.
For example, a differing footer item count or size does not change a count based
on an already established leading extent. A missing byte from that extent still
fails as truncated input. Unusable sizes, unknown layout versions and APE role
bits that cannot identify a supported header/footer remain errors.

Once terminal metadata begins, audio counting cannot resume. A frame-like or
tag-like value inside an established frame/envelope is payload. Forward tag
chains have no artificial depth/count cap; normal streaming/deadline controls
still apply.

Footer-only APEv1/v2 does not declare its payload length until the end. At an
unknown terminal boundary, retain **at most 64 KiB** of the remaining suffix,
then locate complete chains backward at EOF with **4096 alternative selections**
at most. Reject a larger unknown suffix immediately. This allowance also bounds
ambiguous footer-only combinations; it does not restrict declared forward bodies.
Recognized forward envelopes take precedence over descriptors inside their payload.

`consumeMetadata` receives a prefix already read by the counter and consumes one
recognised tag or the complete unknown suffix. It returns no result; the counter
reads again to observe the next boundary or EOF. Unknown-suffix traversal starts
at the end of the buffered bytes and works backward using footer sizes. When a
footer declares a separate header, its signature must appear at the calculated
start, but other header fields need not match. Reaching offset zero accounts for
every buffered byte as metadata. A failed interpretation allows another saved
boundary to be tried; leftover junk rejects the suffix if no layout covers it.

The two metadata budgets protect different resources. The 64 KiB allowance caps
retained memory when the length arrives only in a footer. The 4096-alternative
allowance caps work caused by overlapping possible tag boundaries. Large tags
with a leading length do not need that buffer, and ordinary forward tag chains
do not consume the ambiguity allowance. Backward searching still yields and
checks cancellation after source EOF, because searching buffered bytes uses CPU.

Size fields also differ by format: ID3's declared payload size excludes both
header and footer, whereas APE's declared size includes its footer but excludes
a separate header. The descriptor helpers name those values explicitly so the
forward skip and backward boundary calculations use the same convention.

APEv1 remains footer-only; its flags are ignored rather than interpreted as v2
layout flags. Relaxed metadata checks can admit extra possible suffix layouts.
The alternative-search limit still applies, so inputs with excessive overlapping
interpretations can be rejected even if one layout would eventually fit.

Primary format references: [ID3v2.4 structure](https://id3.org/id3v2.4.0-structure),
[APEv2 specification](https://wiki.hydrogenaudio.org/index.php?title=APEv2_specification)
and [TagLib's bundled APE format](https://github.com/taglib/taglib/blob/master/taglib/ape/ape-tag-format.txt).
These references describe the formats; the counter uses only their boundary fields.

## Physical carriers and independent expectations

Xing/Info data can occupy a genuine MPEG frame. Count that carrier even when a
decoder omits it from audio packets. The unchanged sample has 6089 decoder packets
plus one Xing carrier: **6090 physical frames**. The VBR fixture has 22 packets
plus one carrier; the real free-format fixture has 22 frames at 1200-byte intervals.
The [fixture guide](../tests/fixtures/README.md) preserves hashes and independent
provenance. Parser output never defines its own expected answer.

## Deliberate limits

MPEG-2/2.5 and other layers remain outside scope. Reject unsupported/reserved
headers, no-frame input, incomplete frames/tags and invalid trailing bytes.
Parsing and provisional counting begin before upload EOF; a successful response
still requires the complete valid file, multipart envelope and HTTP body.
A plausible framing layout may contain invalid compressed samples, CRCs or
metadata descriptors or items. A correct count relies on usable boundary lengths;
the parser cannot recover audio hidden by an incorrect declared extent. This is
structural counting, not decoding or metadata conformance certification.
