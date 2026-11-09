# 001 · Count an uploaded MP3

## Outcome

A reviewer can install the project, start its API, upload the unchanged supplied
sample and receive exactly `{"frameCount":6090}`. This first vertical slice proves
the HTTP/domain boundary with real bytes. It is an intermediate milestone: the
final assignment also needs the compatibility and operational cycles in the
[delivery map](../README.md).

## Acceptance

| ID | Observable requirement |
| --- | --- |
| C01 | `POST /file-upload` accepts exactly one multipart file named `file`; success is HTTP 200 with JSON containing only a positive integer `frameCount`. |
| C02 | Count physical indexed-bitrate MPEG-1 Layer III frames, including Xing/Info carrier frames. Support CBR/VBR, 32/44.1/48 kHz, padding, mono/stereo and CRC-bearing framing. Do not decode audio or trust advertised counts. |
| C03 | Accept leading ID3v2.2/2.3/2.4 envelopes with validated sizes/flags and paired footer where required, plus terminal ID3v1. Tag-like bytes inside established frames remain payload. |
| C04 | Reject empty audio, unsupported versions/layers, reserved headers, truncated frames/tags and intervening/trailing junk. Never return a partial successful count. Free-format and other metadata are explicitly deferred to 002. |
| C05 | Preserve the supplied sample's hash and return6090; independently established CBR/mono/VBR fixtures return21/15/23. Valid MPEG-2 is rejected. Filename and claimed part MIME do not determine format. |
| C06 | Wrong/missing/empty file and malformed media/multipart return400; configured file/part/field limits return413; unsupported request type/encoding return415; unexpected I/O faults return a generic500. Errors are JSON objects with one `error` string. |
| C07 | A file defaults to a100MiB limit, with exactly one file part and no fields. Reception and counting use bounded buffers rather than a full-file in-memory value. Every accepted/rejected request settles its owned resources. |
| C08 | Validate the complete multipart and HTTP body before successful response. Valid MIME whitespace and boundary parameters work; absent/invalid boundaries fail safely. Content-Encoding is absent or identity. |
| C09 | Real HTTP tests exercise the sample, additional fixtures, input rejections and resource disposal. Strict typecheck, lint, unit and integration coverage pass through one documented verify command. |

## Scenarios and limits

1. Upload the supplied file from curl and observe6090 with a JSON content type.
2. Upload malformed, oversized or mislabeled content and receive the documented
   error; a subsequent valid request still succeeds and owned data is disposed.
3. Count a completed fixture independently of HTTP; I/O failures remain distinct
   from invalid-media errors.

This milestone is intended for local evaluation. Complete replica admission,
deadlines, cancellation/drain and deployment qualification belong to later cycles.
Framing checks do not validate CRC values or compressed audio samples.

## Verification

Use literal header/tag vectors and independently known real-file counts, then
exercise a listening Fastify instance. Record the tested revision and observed
results in `verification.md` before merging this feature.
