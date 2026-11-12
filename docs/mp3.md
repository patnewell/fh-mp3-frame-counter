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

Leading ID3v2.2/2.3/2.4 declares a synchsafe body length. Validate its version,
flags, length bytes and any required paired footer, while skipping body bytes
incrementally. Leading paired APEv2 works the same way. No large declared body
needs to be retained.

After audio, recognized forward envelopes take ownership of their whole extent:

| Envelope         | Forward treatment                                                          |
| ---------------- | -------------------------------------------------------------------------- |
| ID3v1            | Consume exactly 128 bytes beginning with `TAG`                             |
| Paired APEv2     | Validate the header, skip its declared payload and match the footer        |
| Appended ID3v2.4 | Require its paired footer, skip its declared payload and match descriptors |

Once terminal metadata begins, audio counting cannot resume. A frame-like or
tag-like value inside an established frame/envelope is payload. Forward tag
chains have no artificial depth/count cap; normal streaming/deadline controls
still apply.

Footer-only APEv1/v2 does not declare its payload length until the end. At an
unknown terminal boundary, retain **at most 64 KiB** of the remaining suffix,
then validate complete chains backward at EOF with **4096 alternative selections**
at most. Reject a larger unknown suffix immediately. This allowance also bounds
ambiguous footer-only combinations; it does not restrict declared forward bodies.
Recognized forward envelopes take precedence over descriptors inside their payload.

APE checks cover versions, size, reserved bytes, allowed flags and required pairs.
APEv1 is footer-only and requires zero flags; v2-only header flags cannot create
a v1 pair. Malformed pairs, incomplete envelopes and junk are invalid.

Primary format references: [ID3v2.4 structure](https://id3.org/id3v2.4.0-structure),
[APEv2 specification](https://wiki.hydrogenaudio.org/index.php?title=APEv2_specification)
and [TagLib's bundled APE format](https://github.com/taglib/taglib/blob/master/taglib/ape/ape-tag-format.txt).
The parser validates envelope framing, not individual metadata item semantics.

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
metadata items. This is structural counting, not decoding or malware inspection.
