# Testing and review

Use the pinned Node version and [platform commands](development.md). `verify`
lints, typechecks, builds cleanly and runs Vitest with V8 coverage. Unit-only
runs execute TypeScript source; integration/all-test scripts build first.
Ordinary tests need no media tools, database or Docker daemon.

## Evidence by boundary

| Location                                       | Purpose                                                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/mp3/`                              | Pure headers, arbitrary chunks, complete-frame counting, metadata, local free-format inference, resource bounds, cancellation and iterator ownership |
| `tests/unit/upload/`                           | Admission isolation/idempotence/drain and safe error/rejection classification                                                                        |
| `tests/unit/config.test.ts`, `logging.test.ts` | Immutable settings and actual root/nested-child privacy at configured levels                                                                         |
| `tests/unit/harness.test.ts`                   | Actual Biome import boundary and official Lean skill hashes                                                                                          |
| `tests/integration/fixtures.test.ts`           | Unchanged fixture identities/counts and a lazy 71,901,184-byte real-audio traversal                                                                  |
| `tests/integration/upload.test.ts`             | Listening HTTP, all fixtures, envelopes, invalid inputs, limits and recovery                                                                         |
| `tests/integration/multipart.test.ts`          | MIME/boundary normalization, malformed parts, encoding and HTTP-body completion                                                                      |
| `tests/integration/upload-lifecycle.test.ts`   | Explicit parser/stream barriers for overload, cancellation, deadlines, provisional work and settled ownership                                        |
| `tests/integration/closing.test.ts`            | Active keep-alive connection after close begins retains exact draining response                                                                      |
| `tests/integration/operations.test.ts`         | Liveness, accepting/draining readiness and saturation policy                                                                                         |
| `tests/integration/process.test.ts`            | Compiled startup, sample, probes, trace privacy, malformed transport and bounded shutdown                                                            |
| `scripts/container-smoke.ts`                   | Actual image/runtime restrictions, sample, probes and clean stop without writable upload storage                                                     |

Real sockets exercise multipart parsing, streams and connection closure. An
injected response alone does not establish that transport behavior.

## Independent inputs and parser progress

The supplied sample still yields **6090** physical frames. The
[fixture manifest/guide](../tests/fixtures/README.md) preserves all six assets,
hashes and independently established counts. Tests never derive expected counts
from the application parser. Synthetic vectors isolate malformed headers,
truncation and payload lookalikes.

Parser tests cover every header split, one-byte and deterministic varied chunks,
multiple frames per chunk, split payloads, VBR/padding changes and split metadata.
A lazy source repeats the 21-frame, 8777-byte frame-only fixture 8192 times:
71,901,184 bytes and 172,032 frames, without writing or accumulating that input.
This test proves correct traversal; the separate resource checks measure memory.

A listening HTTP regression streams 12,000 repetitions of that fixture without
accumulating the body: 105,324,000 file bytes exceed the former 100 MiB cap and
must return 252,000 frames without a file-size override. It also catches an
accidentally restored multipart dependency default. Multipart count limits,
invalid-media recovery, deadlines and admission ownership remain separate checks.

A controlled incomplete source supplies an invalid ID3 descriptor while keeping
EOF unavailable. Rejection before another pull proves parsing starts before EOF,
which input consumption alone would not establish. Event-loop/cancellation cases
cover both large chunks and many small chunks. Small split descriptors own their
bytes, and tests check iterator closure and source backpressure.

The [005 compatibility matrix](../specs/005-incremental-mp3-parsing/spec.md#compatibility-matrix)
explicitly replaces seek-based synthetic expectations. Tests now reject a free
layout after a locally committed false boundary, enforce fixed distance/search/run
bounds, prefer recognized forward metadata and bound unknown trailing suffixes.
The fixture oracles, ordinary framing and truncated-extent assertions remain.
The [S18 amendment](../specs/005-incremental-mp3-parsing/spec.md#count-only-metadata-amendment-2026-11-13)
replaces metadata-conformance rejections with successful counts when lengths
remain usable. Unit cases cover ignored fields, conflicting descriptors,
forward/backward size ownership, fallback between suffix layouts and retained
resource/cancellation bounds. Real HTTP cases count audio with differing ID3
footers or APE reserved bytes and still reject truncated declared metadata.

## Deterministic lifecycle tests

Use explicit barriers to hold parser work after an abort or response. Capacity,
application drain and close must remain occupied until that work settles. Test
owners release barriers and close sockets in `finally`; observation timeouts do
not transfer ownership of the underlying operation.

An unfinished HTTP epilogue now permits provisional parser work but prevents
success and remains subject to the admission deadline. This supersedes 003 U05's
old prohibition on counting before HTTP completion. Additional/malformed parts
must reject even when the first file has already produced a valid count.

Temporary-file creation/removal failures, orphan disposal, seek-window reads and
filesystem readiness probes are obsolete in 005. Their resource guarantees are
covered by stream closure, pending/failed parser ownership, iterator failures,
transport recovery and accepting/draining readiness. No obsolete storage test is
presented as execution evidence for the new responsibilities.

## Coverage and review

Thresholds remain 90% statements, 85% branches, 90% functions and 90% lines over
`src/`. Only executable `server.ts` and `healthcheck.ts` are excluded; compiled
child-process tests exercise them separately. No new exclusion or lower threshold
supports this migration.

Vitest writes ignored `reports/tests.json` and `coverage/` outputs. The active
feature's [verification record](../specs/005-incremental-mp3-parsing/verification.md)
contains actual commands, revision, results, compatibility decisions and review
findings. Historical milestone evidence remains accurate for its own revision.
Review the complete diff, changed checks and ownership paths as carefully as the
parser. Coverage alone does not prove that an acceptance case exists.

## Process, platform and container checks

Compiled process tests launch from an unrelated directory with spaces and check
sample counting, safe configuration failures, private logs, real malformed
multipart and silent healthcheck success/refusal/non-ready/deadline behavior.
Held/failed parser fixtures replace the former disposal fixtures while preserving
late-failure privacy, actual settled-work ownership and final shutdown bounds.

Exactly **three tests skip native Windows** because child-process termination
does not deliver POSIX signals to JavaScript handlers:

- SIGTERM allows an admitted upload to complete during grace.
- SIGINT grace expiry cancels an unfinished upload and awaits settled work.
- Repeated signals do not reset the final bound for uncooperative parser work.

The former POSIX FIFO readiness test is removed with filesystem probing. The
three signal cases run on Linux/macOS; their skips do not claim equivalent Windows
coverage. Docker's Linux process provides a separate real signal boundary even
when invoked from Windows/macOS.

The container smoke creates unique owned resources and finally removes them.
It verifies a read-only root, non-root code execution, no writable upload mount,
health, original-sample 6090, security/resource policy and clean stop. A missing
Docker engine means unexecuted container evidence, not an equivalent text check.

## Large-input resource checks

Heavy checks remain separate from the normal gate:

| Platform           | Isolated server process      | Constrained Linux container            |
| ------------------ | ---------------------------- | -------------------------------------- |
| Linux/Unix         | `npm run test:resources`     | `npm run test:resources:container`     |
| macOS              | `npm run test:resources`     | `npm run test:resources:container`     |
| Windows PowerShell | `npm.cmd run test:resources` | `npm.cmd run test:resources:container` |

Inputs lazily repeat known frame-only fixture bytes to exceed 512 MiB, use test-only
concurrency/deadline overrides, and compute expected counts from repetitions × 21.
Neither client nor server constructs a complete upload. The native check samples
server RSS/peak RSS in an isolated child and reports client memory separately;
its generous 256 MiB server ceiling detects whole-file accumulation without
relying on tiny baselines or brittle garbage-collection timing. JavaScript heap
usage alone is not accepted as total-memory evidence.

`scripts/resource-check.ts` writes ignored `reports/resources-native.json` or
`reports/resources-container.json`. The native command builds first and launches
the existing `dist/server.js` entrypoint. A measurement-only preload,
`scripts/resource-monitor.ts`, reports server RSS and the OS high-water RSS over
IPC; it creates no application or network listener and cannot keep shutdown alive.
The check asserts and records the actual server entrypoint. Client observations
are separate. The Docker command builds its image
and needs no host dependency installation. Both measured server variants use a
128 MiB old-space limit; the container additionally enforces 256 MiB total memory
with swap disabled.

The container variant enforces 256 MiB total container memory, read-only root and
no writable upload mount/tmpfs, then checks correct count and survival and records
available container-memory observations. Fixed parser-state bounds, lazy input
and process/container evidence complement one another. Read the
[actual 005 results](../specs/005-incremental-mp3-parsing/verification.md) before
claiming measurements or container execution. These checks establish their test
envelope; they do not establish production throughput, p99 latency or fleet capacity.

<a id="known-dependency-qualification"></a>

## Retained dependency qualification

The earlier Fastify 5.12.8 / multipart 10.1.8 / Busboy 3.2.5 `app.inject` diagnostic
exposed an unhandled part-stream error in a truncated over-limit second-part skip
path. That diagnostic remains historical dependency-risk evidence. Current
compiled-process regressions exercise malformed second parts over Content-Length
and chunked real HTTP; their execution/results belong in the active record.
No private dependency patch, global exception handler or weakened multipart limit
hides the issue. Qualify a proposed upstream change with isolated reproduction
and the real-wire regressions before changing the pin.
