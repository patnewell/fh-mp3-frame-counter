# 005 · Verification

## Baseline and sequence

Work began on 2026-11-12 from clean `main` at
`2c91ebaf5fa526bea4d1641fe41eb5a7188837bb`, on native Windows x64 with the
pinned Node 24.22.3. Existing history and `v1.0.0` remain intact. This cycle uses
`feature/005-incremental-mp3-parsing` and the explicit 005 feature pointer.

The observable specification (`8f0c5e8`), implementation plan (`d32a44e`) and
ordered tasks (`b07e5d8`) were separate commits before implementation. The
original assignment was read; its physical MPEG-1 Layer III count, exact response,
TypeScript and no media-parser-package requirements remain in force.

## Regression before implementation

`npm.cmd exec -- vitest run tests/unit/mp3/incremental.test.ts` failed against
the old parser: the asynchronous source was passed to `fs.open`, producing a
path-argument TypeError instead of counting two frames. Commit `95c8067` retains
that regression before the domain implementation.

## Compatibility and replacement rationale

The [specification](spec.md) records the pre-implementation compatibility matrix
and concrete examples. No committed fixture byte, hash or expected count changes.

| Previous check family                                             | Replacement responsibility                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| File seek/cache and missing-path errors                           | Stream chunk carry, backpressure, iterator release, cancellation and upstream errors. Production parsing has no path to open.        |
| Complete-suffix free-format rollback and file-size search budgets | First local compatible boundary, later contradiction rejection, 128 KiB distance, 16 MiB total search and 4096 inference-run bounds. |
| Global backward metadata ambiguity on repeated recognized tags    | Forward envelope precedence and long ordinary chains, with a 64 KiB unknown terminal suffix and bounded fallback ambiguity.          |
| No parsing during open HTTP epilogue                              | Provisional parser work is required; success still waits for full HTTP EOF (003 U05 is superseded).                                  |
| Upload directory creation/removal and disposal failures           | Direct stream/parser error recovery and held/uncooperative parser settlement. No upload files or disposal operation remain.          |
| Storage startup/readiness/FIFO ownership                          | Readiness tracks admission, including saturation/draining; disconnected parser work remains owned by application close.              |
| POSIX final bound with hung disposal                              | The same final bound with unsettled parser work and repeated signals.                                                                |

## Domain increment

`npm.cmd exec -- vitest run tests/unit/mp3 tests/integration/fixtures.test.ts`
passed **141 tests across seven files** on 2026-11-12. All six mandatory fixture
hashes/results remain unchanged. The lazy 71,901,184-byte traversal still returns
172,032 frames; its source no longer creates a temporary file or complete buffer.
Controlled input verifies invalid-descriptor rejection before requesting EOF;
both a large producer chunk and one-byte chunks permit event-loop cancellation.

Review found that metadata mode must not resume audio when an undeclared APE
body contains frame-shaped bytes. Keeping that mode locked preserves the mixed
metadata regression; raw resumed audio remains invalid. Review also reduced
fallback checkpoint spacing to 128 descriptor transitions so its repeated CPU
work yields within the progress bound. Tiny retained prefixes/descriptors own
their bytes rather than pinning prior producer chunks. The focused suite passes
after these corrections. The HTTP adapter still awaits migration in T02; this
is parser evidence, not a claim that the complete application gate has run.

## Completion evidence

### Streaming service increment

Commit `0d3c88d` contains the direct multipart-stream adapter, storage-free app/
configuration/readiness, processing-only failure category and replacement HTTP/
process ownership regressions. It also strengthens the actual parser import
boundary to reject filesystem imports; a new executable Biome harness case
verifies this. No coverage threshold/exclusion or fixture oracle was changed.

The first complete working-tree `npm.cmd run verify` passed lint, typecheck,
clean build and coverage: **332 passed, zero failed, three skipped** (335 cases
across 20 files). Skips are only the real POSIX signal mechanisms on native
Windows; the filesystem FIFO case was replaced by portable parser ownership.
Additional focused review then added five permanent fallback-bound/cancellation/
producer-reuse tests; the metadata suite passed **41/41**. The final count and
clean-revision gate will be recorded below after complete-diff review.

### Preliminary resource evidence

The isolated native `npm.cmd run test:resources` passed on the working changes
based on `861f998`: **536,871,536 bytes**, lazily generated as **61,168 × 8777**
bytes, returned **1,284,528 = 61,168 × 21** physical frames and the server remained
live. The fixture block's length/hash is checked independently of the parser.
Server baseline RSS was 83,910,656 bytes; OS peak RSS was **100,499,456 bytes**
(about 95.8 MiB), below the generous 256 MiB ceiling. There were 61 server memory
observations; client peak RSS was separately 83,623,936 bytes. This execution was
2026-11-12 22:20:14.845–22:20:19.985 UTC, not a backdated commit time.

This is measured bounded-memory evidence for the lazy-input test, not a measured
comparison with the old implementation or a production throughput benchmark.
Review subsequently bounded the resource client's drain wait with its deadline
signal and its final child-close observation to five seconds. A clean-revision
resource run after these changes will be recorded below.

Both `npm.cmd run test:container` and `npm.cmd run test:resources:container`
stopped at preflight with **`spawn docker ENOENT`**. No Docker build, read-only
runtime, enforced container-memory, upload or stop assertions executed here.
The updated executable checks and CI steps are supplied; hosted execution,
native Linux/macOS and production load remain unexecuted.

### Final review and clean revision

Pending complete-diff review and final clean-revision checks.
