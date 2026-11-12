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

Independent agents applied `review-change` to the complete feature diff from
`2c91eba`, with separate review of parser invariants, transport/runtime ownership,
resource checks and current documentation. Findings and disposition:

1. **Metadata mode and retained chunks.** The mixed-terminal-envelope regression
   exposed audio-shaped bytes inside an undeclared APE body. Metadata mode now
   remains locked; tiny prefixes and saved descriptors own copies before later
   pulls. Raw resumed audio still rejects. Reused-producer-buffer regressions pass.
2. **Fallback CPU/search ownership.** Fallback validation yields every 128
   descriptor transitions. Permanent tests exercise the actual 4096-alternative
   ceiling inside a 65,409-byte suffix and cancellation scheduled only at EOF.
3. **Bounded resource-client observations.** Review found an unbounded drain wait
   after a clean early connection close and an unbounded child-close observation.
   The upload shares its absolute deadline with each drain wait; child termination
   has a five-second final observation bound. The clean native resource run below
   passes after these corrections.
4. **Preserved independent healthcheck coverage.** Removing filesystem readiness
   had also removed the completed HTTP 503/silent exit-one case. A dedicated
   compiled-process regression restores that unrelated guarantee in `bd8ca26`.
5. **Real malformed-part probes.** Independent isolated compiled HTTP probes of
   truncated second files, truncated second fields and an empty second file all
   returned 413, preserved liveness and omitted private markers. Existing permanent
   real-wire malformed-part cases remain passing; the historical dependency
   qualification is not claimed resolved for every possible event ordering.

No review findings remain. No fixtures, dependencies, vendored skills, historical
001–004 specifications/evidence, coverage thresholds or exclusions changed.
The intentional gate change strengthens parser filesystem independence and is
checked by the actual Biome harness. Agent review is not human approval.

On clean **`bd8ca2621928eff2cd3ac3728537ad6d3d1adb47`**, native Windows x64 /
Node 24.22.3, `npm.cmd run verify` passed lint, strict typecheck, clean compilation
and **338 passed, zero failed, three expected POSIX skips**, across 20 files.
Coverage: **95.52% statements** (577/604), **93.55% branches** (392/419),
**97.70% functions** (85/87), **97.54% lines** (517/530). All mandatory fixture
hashes/results and the exact sample response remain passing. The final evidence
commit only records these results and completes the checklist; it changes no
application or test behavior.

The clean native resource run was on
**`01d4d664b25e3325ac727dbba288b01fc1b5e038`**, with
`workingTreeDirty: false`. Production source, resource scripts, Dockerfile and
package.json are byte-identical between that revision and `bd8ca26`.
`npm.cmd run test:resources` succeeded at **2026-11-12
22:29:01.386–22:29:03.028 UTC** (17:29 EST):

| Observation                       | Actual result                                        |
| --------------------------------- | ---------------------------------------------------- |
| Lazily generated file bytes       | 536,871,536 (>512 MiB)                               |
| Independent count                 | 61,168 repetitions × 21 = 1,284,528 frames           |
| Actual response                   | Exactly `{"frameCount":1284528}`; liveness still 200 |
| Server baseline RSS               | 83,742,720 bytes                                     |
| Server OS peak RSS                | **101,130,240 bytes (about 96.4 MiB)**               |
| Server RSS ceiling / observations | 268,435,456 bytes (256 MiB) / 51 samples             |
| Separate client OS peak RSS       | 85,024,768 bytes                                     |

The ignored `reports/resources-native.json` records the real revision, times,
server/client observations and limits. This is a tested resource envelope, not a
claim of production throughput, universal RSS bounds or measured savings versus
the original staging implementation.

Both Docker commands were attempted again on clean `01d4d66` and stopped at
`spawn docker ENOENT`; `reports/resources-container.json` says `unavailable`,
not passed. Container memory enforcement, read-only mount-free execution and
Linux/macOS POSIX shutdown remain unexecuted here. CI is configured to run the
full platform matrix and separate native/container resource checks; no hosted
execution or protection policy is claimed. `v1.0.0` remains at annotated tag
object `78fdfc6c9aaf2bbace03c44ad0c7096ae41238d9`. No push or timestamp rewrite
was performed. Local merge follows this verified evidence commit.
