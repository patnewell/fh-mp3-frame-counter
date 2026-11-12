# 005 · Implementation plan

## Context and boundaries

Start at `2c91ebaf5fa526bea4d1641fe41eb5a7188837bb`. Retain pinned Node,
TypeScript, Fastify/multipart, Vitest and Biome. The original assignment requires
physical MPEG-1 Layer III counting, exact JSON, understandable code and practical
large-file handling; it does not require seek-based ambiguity resolution.

## Domain algorithm

Expose `countFrames(input: AsyncIterable<Uint8Array>, signal?)`. Keep the pure
`readHeader` decoder. Replace FileReader with a small stream cursor that owns its
iterator, carries only incomplete descriptors, skips payload in bulk, observes
cancellation, and yields via Node's promise-based setImmediate every 64 KiB of
progress. Retain at most one borrowed producer chunk, fixed descriptor scratch,
and a 64 KiB unknown terminal suffix. Copy retained descriptor fragments instead
of keeping tiny views of prior chunks. Returning/throwing closes the iterator;
propagate upstream failures. The caller remains responsible for interrupting a
blocked source read; the transport destroys the file stream on cancellation.

At each established boundary, decode four bytes. For indexed frames, use that
header's length and discard the remaining payload; increment only after full
consumption. VBR requires no seeking because each frame supplies its own indexed
length. Never inspect known payloads. At EOF require at least one complete frame.

For a new free-format run, search forward from minimum framing overhead for the
first same-rate free header whose inferred unpadded length supports both headers'
overheads/padding. Search windows synchronously in bulk, carrying split header
bytes, rather than creating promises per scanned byte. Limit unpadded distance
to 128 KiB, total search positions to 16 MiB and inference runs to 4096. Arrival
at that candidate completes the preceding frame. Keep one inferred numeric
length/rate until an indexed frame or rate change. No replay stack, EOF-sized
budget or full-suffix retries remain. A later contradiction rejects the stream.

Metadata consumes descriptors and skips declared bodies. Leading ID3 and paired
APE retain only enough bytes to compare required footer fields. After the first
audio run, recognized terminal TAG/paired ID3v2.4/paired APE envelopes commit
forward, validating each before the next. At an unrecognized terminal boundary,
collect at most 64 KiB then validate the complete suffix backward in memory using
the existing envelope rules; cap alternative choices at 4096. This limited
fallback supports footer-only APE payloads without making the normal audio or
declared-metadata path accumulate bytes. Reject audio after terminal metadata.
Store flags/offsets with named constants, keeping modules cohesive and local.

Use a small `reader.ts` replacement only if its stream responsibilities justify
it; remove obsolete seek-only types/exports/tests. `tags.ts` owns envelopes,
`free-format.ts` owns inference bounds, and `count.ts` owns frame traversal.

## Transport and runtime

The upload route retains a single count seam accepting the async iterable and
signal; remove dispose seams. Run file consumption and the parser inside the
existing request lifetime. Attach a cancellation listener that destroys the file
stream and await its settlement in finally. Do not race away from a pending
counter. Convert file-limit truncation to 413 even if parser EOF would otherwise
look like an invalid frame. After file counting, exhaust/validate multipart parts
and await complete HTTP EOF before returning the count. Extra/malformed parts
must still reject a provisionally valid first file.

Keep admission and request lifetime ownership; simplify only obsolete storage
work. Preserve 503/retry/connection policy and bounded rejection draining.
Remove filesystem imports/probes from production app/config/upload code,
`UPLOAD_TEMP_DIR`, and cleanup-category log events. Readiness returns 200 only
while admission accepts work, including temporary saturation, and 503 during
draining. Keep the existing executable healthcheck and process shutdown logic.
Replace disposal fixtures with held/failed parser fixtures to retain late-failure
privacy, unsettled-work final-bound and cancellation evidence.

## Tests, resource evidence and deployment

First add stream-based regressions that fail against the old path API. Adapt
all parser cases according to the spec's explicit compatibility matrix, keeping
unchanged real fixtures and independent oracles. Test arbitrary splits, tiny and
large chunks, lazy source backpressure, errors before EOF, iterator release,
yielding, every inference/suffix bound and malformed envelopes. Seek and storage
tests become stream/ownership tests; record those replacements in verification.

Then exercise all real fixtures and multipart/lifecycle cases over real HTTP.
Keep controlled promise barriers and replace storage observations with parser
start/read/settlement barriers. An incomplete epilogue must allow provisional
counting but forbid success. Replace filesystem readiness ownership with pending
parser ownership; retain unrelated configuration, logging, headers and process
tests. Do not broaden source coverage exclusions or lower thresholds.

Update Docker smoke to omit the writable tmpfs and check empty writable-mount
policy along with read-only root, non-root user, restricted capabilities/resources,
sample count, health and graceful stop. Add separate `test:resources` and
`test:resources:container` scripts. The native check launches an isolated compiled
server harness that reports server RSS (and peak RSS) over IPC, lazily sends over
512 MiB of repeated frame-only fixture bytes with backpressure, validates the
independent count and survival, and applies a generous 256 MiB server RSS ceiling.
Client memory is reported separately. The Docker version enforces 256 MiB total
container memory, 128 MiB old-space, read-only root and no writable upload mount,
samples container memory where available, and performs the same lazy count check.
No huge fixture or project dependency is added. Record unavailable Docker exactly.

## Delivery and review

Commit this plan and tasks before implementation. Implement domain and its tests
as one usable increment, then transport/runtime/deployment/docs as the next.
Independent agents may own disjoint source/test files within an increment; no
concurrent feature or shared feature pointer is introduced. Review the complete
diff using `review-change`, challenge buffering/iterator ownership/late transport
errors and stale storage references, then run the full gate and heavy resource
checks. Commit actual evidence and merge locally only after required executable
gates pass; qualify unavailable environments. Keep historical docs/specs/results,
Git identity, release tag and commit timestamps intact. Push nothing.
