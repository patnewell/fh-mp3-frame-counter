# MP3 framing for this assignment

An MP3 file contains a sequence of compressed MPEG audio frames, often surrounded
by metadata. This service counts physical MPEG-1 Layer III frames. It does not
decode audio samples or estimate a count from duration or metadata totals.

## Header and length

Each MPEG audio frame starts with a four-byte header. Relevant fields are:

| Bits, from most significant | Meaning for counting                                           |
| --------------------------- | -------------------------------------------------------------- |
| 31–21                       | Eleven synchronization bits, all 1                             |
| 20–19                       | MPEG version; `11` is MPEG-1                                   |
| 18–17                       | Layer; `01` is Layer III                                       |
| 16                          | CRC protection flag; affects framing overhead, not the count   |
| 15–12                       | Bitrate index; ordinary MPEG-1 Layer III rates are 32–320 kb/s |
| 11–10                       | Sample rate: 44.1, 48 or 32 kHz; reserved value rejected       |
| 9                           | Padding adds one byte to an indexed frame                      |
| 7–6                         | Channel mode, including mono                                   |
| 1–0                         | Emphasis; reserved value rejected                              |

For indexed MPEG-1 Layer III, frame length is
`floor(144000 × bitrateKbps / sampleRateHz) + padding`. It includes the header,
optional CRC and compressed payload. Read each next header at the calculated
boundary; never count arbitrary sync-shaped bytes inside payloads. VBR changes
the bitrate between frames, so calculate each length independently.

Counting framing does not require decoding the bit reservoir or checking CRC
values. A structurally plausible frame can contain invalid compressed audio.
EOF inside a declared frame is invalid; an error never returns a partial count.

## Metadata and carrier frames

Leading ID3v2 headers declare a synchsafe size: the high bit of each size byte is
zero. Validate version/flags and envelope length, skip the payload and compare an
optional ID3v2.4 footer. A terminal ID3v1 tag is 128 bytes beginning with `TAG`.
Recognize it only at an established frame boundary, so payload lookalikes do not
shorten audio. See the primary [ID3 structure specification](https://id3.org/id3v2.4.0-structure).

Xing/Info metadata can occupy a genuine MPEG frame. It still contributes one
physical frame even if a decoder omits it from its audio-packet list. The supplied
sample has 6,089 decoder packets plus one carrier, yielding **6,090**. The fixture
guide records exact offsets, hashes and independently verified counts.

## Compatibility milestones

Feature 001 handles indexed CBR/VBR, leading ID3 and terminal ID3v1. Free-format
MPEG-1 is valid but requires length inference; advanced metadata and ambiguity
policies are deliberately specified in 002 before implementation. The initial
milestone is not a claim that all final compatibility has already been delivered.
