# 005 · Incremental MP3 parsing

## Outcome and scope

Count physical MPEG-1 Layer III frames directly from an asynchronous byte stream
while the upload arrives. Preserve the exact POST `/file-upload` response,
mandatory real fixtures, useful errors and settled-work ownership. Remove upload
storage entirely. This supersedes seek-dependent choices from 002, the counting
timing in 003 U05, and storage responsibilities in 003 U07/004 O03/O08/O09.
Earlier specifications and execution evidence remain historical.

## Observable requirements

| ID  | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | The domain counter accepts `AsyncIterable<Uint8Array>` and optional cancellation, with no transport, environment or filesystem dependency. Consume with backpressure; never stage or accumulate the complete upload.                                                                                                                                                                                                                         |
| S02 | Assemble split headers, determine each indexed CBR/VBR frame length from its own header/padding, discard payload without scanning it, and count only complete frames. Reject unsupported versions/layers, reserved headers, junk, no-frame input and truncated headers/frames. Count physical Xing/Info carriers without trusting advertised totals.                                                                                         |
| S03 | Preserve all six committed fixture bytes/hashes and independent results: sample 6090, CBR stereo 21, tagged mono 15, VBR 23, free-format 22; reject the MPEG-2 fixture. Exercise parser and listening HTTP boundaries.                                                                                                                                                                                                                       |
| S04 | Parse and provisionally count before input EOF. Successful HTTP response requires valid file EOF, complete valid multipart and complete HTTP body. An unfinished epilogue prevents success, but does not prevent parser work. This replaces 003 U05.                                                                                                                                                                                         |
| S05 | Retain only fixed parser buffers and bounded inference state independent of upload length: at most 64 KiB terminal lookbehind, 128 KiB maximum unpadded free-frame distance, 4096 inference runs and 16 MiB total inference-search positions per stream. No buffer/candidate list grows with frame count. Check limits as input arrives.                                                                                                     |
| S06 | Free-format uses the first compatible free header in ascending forward positions within the distance bound, accounting for both frames' padding and minimum framing overhead. Commit that length for the run; infer again after an indexed frame or sample-rate change. Later layout failure rejects rather than rewinding. A lone unresolved free frame is invalid.                                                                         |
| S07 | Stream-skip declared leading ID3v2.2/2.3/2.4 and paired APEv2 bodies, validating descriptors/required footers without retaining bodies. After audio, stream-skip recognized forward ID3v1, paired APEv2 and paired ID3v2.4 envelopes. Reject audio after terminal metadata, malformed pairs, nonzero APEv1 flags, invalid/reserved fields and trailing junk.                                                                                 |
| S08 | Footer-only APEv1/v2 has no leading length. Buffer at most 64 KiB of the remaining unknown terminal suffix and validate complete chains backward at EOF with at most 4096 alternative selections. Reject a larger unknown suffix immediately. Recognized forward envelopes take precedence; ordinary forward tag chains have no artificial count/depth cap and large declared metadata is skipped without retention.                         |
| S09 | Bound synchronous progress: yield to the event loop at least every 64 KiB consumed/searched, including a large producer chunk or many tiny chunks. Check cancellation before pulling input and during work; release the upstream iterator on completion/error. Retained fragments own their bytes rather than pinning prior producer buffers. A borrowed current producer chunk is additional input memory, not accumulated parser storage.  |
| S10 | Pass the multipart file stream directly to the counter. Preserve exactly one file field `file`, encoding/type/boundary validation, file/part/field count limits, malformed/truncated media detection, safe JSON errors, rejection byte bounds, disconnects and deadlines. Per S16 there is no application file-size cap; defaults remain four concurrent uploads and 30 seconds.                                                             |
| S11 | Capacity remains occupied until owned file-stream/parser/rejection work settles, even after an early error/deadline/disconnect. Hold application close/drain for pending work. Preserve busy/draining retry headers, graceful signal draining, forced cancellation and final shutdown bound.                                                                                                                                                 |
| S12 | Remove upload files/directories, seek infrastructure, disposal seams, `UPLOAD_TEMP_DIR`, storage probes, orphan policies and cleanup log categories. Readiness reflects accepting work; saturation alone remains ready. Preserve liveness.                                                                                                                                                                                                   |
| S13 | Container runs non-root with a read-only root and no upload mount/tmpfs. Preserve CPU/memory/PID/security/probe/stop restrictions. Supply a separate executable lazy large-upload resource check with independent expected counts and server RSS observations; where Docker is available enforce 256 MiB memory and send more than that budget. Do not claim blocked container checks or heap-only observations prove total-memory behavior. |
| S14 | Keep TypeScript, pinned tooling, existing coverage thresholds/exclusions, fixture identities and unrelated regressions. Replace obsolete storage/seek tests with stream ownership, chunk-boundary and resource regressions and record why each family changed. Update current docs and commit the genuine Lean sequence locally; do not push or rewrite history/tags.                                                                        |

## Compatibility matrix

| Earlier contract             | Streaming outcome                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 001 C01/C02/C05/C08; 002 M01 | Preserved endpoint, exact JSON, indexed framing, carrier counts, all real-fixture oracles and complete-success validation.                                                                                         |
| 002 M02                      | Preserve two-frame inference, padding, overhead, indexed transitions and rate changes within the explicit 128 KiB distance limit.                                                                                  |
| 002 M03                      | Replace complete-suffix/depth-first retries with the first local compatible boundary; no rollback after commitment.                                                                                                |
| 002 M04                      | Preserve 4096 inference runs; replace completed-file-size work accounting with a fixed 16 MiB inference-position budget enforced before EOF. Ordinary indexed traversal has no total-size-dependent parser budget. |
| 002 M05                      | Preserve envelope families and validation; large declared bodies stream through. Footer-only/unknown trailing bytes have a 64 KiB suffix allowance.                                                                |
| 002 M06                      | Forward recognized envelopes take precedence; bounded backward ambiguity remains only inside the unknown terminal suffix. Long ordinary ID3v1 chains still work.                                                   |
| 002 M07                      | Preserve frame-boundary precedence and payload lookalikes; malformed or incomplete input never yields a partial successful response.                                                                               |
| 002 M08                      | Replace file-cache cancellation with input/loop cancellation and cooperative yielding; fixed retained buffers and no per-frame buffer history.                                                                     |
| 003 U03/U04/U06/U08          | Preserve cancellation, bounded rejection and settled-work admission/close ownership for streams instead of disposal.                                                                                               |
| 003 U05                      | Superseded by S04: parse before HTTP completion, publish success only after full validation.                                                                                                                       |
| 003 U07; 004 O03             | Upload storage and filesystem readiness are removed; independent requests and safe failures remain.                                                                                                                |
| 004 O05/O06/O07              | Preserve probes, compiled process behavior and bounded shutdown; replace storage-specific fixtures with held/failed parser work.                                                                                   |
| 004 O08/O09                  | Same compiled/non-root/read-only deployment without writable upload storage. Container resource test supplies the new memory evidence.                                                                             |

## Explicit examples and changed synthetic expectations

1. A 500-byte free frame can contain plausible headers at offsets 100 and 200.
   The old parser could discover failure at 300, seek backward, and eventually
   select the valid 500-byte layout. That failure may occur arbitrarily far after
   the first choice, requiring unbounded retention or spooling. The new parser
   commits 100 locally and rejects the later failure. The two old tempting/nested
   retry tests become explicit rejection regressions; the six 100-byte earliest
   layout still counts six.
2. Two 1,100,000-byte free frames exceed the new 128 KiB inference distance.
   Their former metadata-budget failure becomes an early distance-limit failure.
   The existing 65,570-byte free-frame case remains supported. Replace the old
   eight-file-length budget unit test with distance/search/run-bound tests.
3. An APE footer can declare that preceding arbitrary bytes are its payload only
   when that footer arrives. The old completed-file parser seeks backward without
   retaining those bytes. The new parser accepts an unknown suffix up to 64 KiB
   and rejects larger suffixes. Paired APE and declared ID3 bodies are not subject
   to this buffer allowance because they can be skipped forward by length.
4. An ID3v1 payload may contain a competing APE descriptor. Forward `TAG` at an
   established boundary owns exactly 128 bytes, so repeated such tags are valid
   without speculative alternative charges. The old 8198-overlap/repeated-suffix
   budget tests become forward-precedence and bounded-fallback tests. Strict APE
   descriptor checks and malformed suffix rejection remain.

## Existing service boundary amendment (2026-11-12)

**S15:** Update the existing `src/server.ts`/`src/app.ts`/upload route in place;
do not introduce a replacement application or server entrypoint. Native resource
measurement must launch the normal `dist/server.js`, asserting and recording
that entrypoint. An optional measurement preload may sample process memory but
must not create applications, network listeners, or references that keep shutdown alive.
A compiled normal-entrypoint HTTP regression must prove parsing occurs while
file and HTTP EOF remain unavailable. This clarifies S04/S13 without changing
framing, metadata or HTTP compatibility.

## File-size policy amendment (2026-11-13)

**S16:** Remove the application's total file-byte cap and the `MAX_FILE_BYTES` /
`maxFileBytes` configuration. Explicitly disable the multipart dependency's
default file-size limit. This supersedes S10's original 100 MiB default/file truncation
policy and the file-size configuration in 004 O01; earlier execution evidence
remains historical. Stream a valid upload above the former 100 MiB cap over real
HTTP without a size override and verify its independently established count.
Keep file/field/part counts, framing validation, bounded retained state/rejection
bytes, deadlines and settled-work ownership. Preserve the per-instance upload
cap; document the active-upload count as the preferred per-pod custom metric for
a Kubernetes HPA, targeting below the cap to scale before saturation. This comment
does not add metric publication or deployment configuration.

## Configuration simplification amendment (2026-11-13)

**S17:** Replace custom environment parsing and validation with Fastify's
`env-schema` library. Use its standard coercion and schema errors, including
accepting signed, exponent and whitespace-padded numeric strings when they
represent an integer within the configured range. Declare only defaults, types,
log levels and the ranges needed by ports, timers and admission. Delegate host
interpretation to the listener, keeping only a nonempty string requirement.
Keep existing defaults, immutable resolved settings and isolated programmatic
configuration; supplied environment data must not merge with ambient process
values. Continue resolving configuration before constructing Fastify and reuse
it in the standalone healthcheck. Do not load `.env` automatically. This supersedes
004 O01's strict-decimal and custom-host validation policy; historical evidence is
unchanged.

## Count-only metadata amendment (2026-11-13)

**S18:** Metadata support exists to locate audio, not certify tag conformance.
This supersedes S07/S08's strict descriptor/pair validation and the corresponding
002 compatibility policy. At an established boundary, a supported ID3v2 header
or paired APEv2 header owns its declared extent. Skip that extent, including any
declared footer, without comparing descriptors or validating metadata contents.
ID3v2.2/2.3/2.4 headers may also appear after audio; only v2.4's footer flag adds
ten bytes. Ignore ID3 revisions/unrelated flags and APE item counts, reserved
bytes, read-only/unrelated flags and differences in a skipped footer.

Retain the signatures, supported layout versions, usable length encodings and
header/footer role bits needed to locate boundaries. For an unknown terminal
suffix, use footer sizes backward; a declared separate header must have its
signature at the calculated start, but its other fields need not match the
footer. APEv1 footer flags do not affect its footer-only extent. Account for the
entire bounded suffix rather than silently accepting arbitrary remaining bytes.
Keep existing memory/work limits, candidate preference, cancellation, iterator
ownership and rejection of unsupported audio, no frames, truncated extents and
audio resuming after terminal metadata. All fixture identities/counts remain.
These rules count structurally identifiable frames; they do not promise to
recover a correct count when metadata length/layout information is unusable.

## Logging scope correction (2026-11-13)

**S19:** Remove 004 O04's operational logging restrictions and the startup-error
redaction requirement from S17. Use Fastify's standard logger with the configured
level; application logging has no content allowlist, message suppression, field
validation or child-binding filtering. Remove the corresponding unit and
compiled-process privacy tests, including privacy-only assertions in otherwise
useful startup, malformed-request and late-failure tests. Retain those functional
tests and the startup/shutdown/upload-failure events used for process observation.
Keep client error responses, parser behavior and resource ownership unchanged.
Earlier plans/tasks and verification results describe the policy at their time.

## Acceptance scenarios and evidence

Test every header split, one-byte/varied chunks, multiple frames per chunk,
partial payloads, independent VBR/padding changes, metadata splits/truncation,
local free-format decisions, every bound, cancellation and event-loop progress.
Use controlled iterators/barriers to prove consumption and failure before EOF.
Use listening HTTP for fixtures, epilogue, malformed/additional parts, limits,
disconnects, deadlines, saturation and close ownership. Use compiled children for
probes and real POSIX shutdown (label native Windows limitations).

The heavy resource check lazily repeats the 21-frame, 8777-byte frame-only fixture
to exceed 512 MiB of input, computes the expected count by repetition, samples
server RSS separately from client memory, and detects complete-file retention
with a generous 256 MiB server threshold. A Docker variant enforces a 256 MiB
container budget, read-only root and no writable upload mount. It is separate
from normal tests. Record actual execution, peaks, revision and unavailable
environments in verification.md. These checks establish their tested envelope,
not production throughput or arbitrary-size support.
