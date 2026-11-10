# Real audio fixtures

`sample.mp3` is the unchanged assignment asset. Its SHA-256 is
`97707a18a58ba75122b1668f5ed738f090121343432d9172a6409ddfa4fc5ab3`.
The [manifest](manifest.json) records byte identity and independent physical counts.
Tests must never use the application parser to establish their expected answers.

| File                          | Independent evidence                          | Expected result |
| ----------------------------- | --------------------------------------------- | --------------- |
| `sample.mp3`                  | 6,089 FFprobe packets plus one Xing carrier   | 6,090           |
| `cbr-stereo-44100.mp3`        | 21 decoded/indexed packets                    | 21              |
| `cbr-mono-32000-tags.mp3`     | 15 decoded/indexed packets, leading ID3       | 15              |
| `vbr-stereo-48000.mp3`        | 22 packets plus one Xing carrier              | 23              |
| `unsupported-mpeg2-22050.mp3` | Valid decoded MPEG-2 at 22.05 kHz, 22 packets | Reject          |

FFprobe and FFmpeg 7.1.5 packet/decode checks were executed on 2026-11-11.
Carrier adjustment is independently visible: the sample's leading ID3 ends at
byte 44, Xing is at 80, and the first FFprobe audio packet starts at 252. The VBR
fixture has corresponding offsets 68, 104, 260. Metadata totals and duration are
not trusted by the application, and carrier frames still count physically.

The additional indexed assets are encoded audio, not fabricated sync-header
buffers. The sample and assets are committed so normal tests require no media
tools. Synthetic unit vectors cover individual byte-level failure cases.

For integrity checks, use `npm run fixtures:verify` on Linux/Unix or macOS, and
`npm.cmd run fixtures:verify` in Windows PowerShell. If FFmpeg tools are installed,
these one-line commands work in Linux/Unix, macOS and PowerShell:

```sh
ffprobe -v error -select_streams a:0 -count_packets -show_entries stream=codec_name,sample_rate,nb_read_packets -of json tests/fixtures/sample.mp3
ffmpeg -v error -i tests/fixtures/sample.mp3 -f null -
```

Packet totals can omit a carrier frame; do not equate them automatically with
physical frame counts. Keep filename, size, hash and independent evidence together
when adding an asset. Do not replace the supplied sample.

## Free-format compatibility

`free-format-stereo-48000.mp3` is 26,400 bytes with 22 compatible boundaries at
1,200-byte intervals. It is real 400 kb/s, 48 kHz stereo encoded audio. Retained
LAME 3.100 authoring evidence reports 22 frames and 24,815 decoded PCM samples
plus 529 skipped delay samples, matching 22 × 1,152. Its hash and header spacing
were rechecked; LAME is unavailable, so a new LAME decode was not executed.
FFprobe 7.1.5 does not decode this asset; that limitation does not make it invalid
MPEG-1. The application must return 22 independently of these tool limitations.
