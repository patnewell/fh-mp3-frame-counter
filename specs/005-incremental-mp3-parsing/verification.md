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

## Existing entrypoint follow-up (2026-11-12)

Base: `bf3813a350b36921cf870a84e32861cbdaa175e1` plus the reviewed working-tree
correction. Inspection against pre-005 `2c91eba` confirms that production was
updated in place: `src/server.ts` retains its original startup/listener and only
two shutdown comments changed; the existing upload route replaced file creation/
write/disposal with `count(part.file, signal)`. Normal start/dev/Docker commands
still use that original server. No additional production application was needed.

The separate `scripts/resource-server.ts` measurement bootstrap made that less
clear, so this correction removes it. A new entrypoint assertion failed against
that bootstrap before the change. Native measurement now launches the normal
`dist/server.js` directly, reads its existing startup event for the port, and
uses a measurement-only preload with no app factory or network listener. The
preload's timer and IPC channel are unreferenced; a child-process regression
proves loading it alone exits zero without keeping Node alive.

A new real-HTTP regression launches the normal compiled server and receives
400 for an invalid ID3 descriptor while the file and HTTP upload remain open.
This demonstrates actual parsing before EOF through the production entrypoint.
The sample, all fixture oracles and settled-work regressions remain unchanged.

`npm.cmd run verify` passed on native Windows x64 / Node 24.22.3:
**340 passed, zero failed, three expected POSIX skips**, across 20 files.
Lint, strict typecheck, clean build and existing coverage gates passed; coverage
remains 95.52% statements, 93.55% branches, 97.70% functions and 97.54% lines.

`npm.cmd run test:resources` also passed using the actual `dist/server.js`:
536,871,536 lazy file bytes returned exactly 1,284,528 frames; liveness remained
healthy. The report explicitly asserts/records the launched entrypoint. Server
baseline RSS was 77,799,424 bytes and OS peak RSS **93,061,120 bytes (88.75 MiB)**,
with 56 observations, against the 256 MiB ceiling. Separate client peak RSS was
75,657,216 bytes. Actual execution: 2026-11-12 23:55:07.980–23:55:09.774 UTC.
These are new observations of the normal executable, not a performance comparison
with the earlier bootstrap. Earlier results remain historical.

Independent `review-change` review found no remaining issues in startup parsing,
entrypoint assertions, monitoring lifetime, bounded observations, documentation or
the two added regressions. Production application/parser code and gates were not
changed by this measurement correction. Docker and other platform qualifications
above remain; no container execution or push is claimed.

## Framework log-level type reuse (2026-11-12)

Tested base `811ef1d3ae903e5b6d6de33b47e4e6d05a3607b8` plus the working-tree
configuration change, on native Windows x64 / Node 24.22.3. `src/config.ts` now
imports and re-exports Fastify's `LogLevel`; the runtime allowlist is checked
with `as const satisfies readonly LogLevel[]`. Accepted values, defaults, runtime
validation and existing type-import paths remain unchanged.

Self-review with `review-change` found no issues in the complete diff or affected
logging/configuration callers. Existing tests cover all seven levels and unknown
value rejection; no new runtime behavior or assertion changes were needed.
`npm.cmd run verify` passed lint, strict typecheck, clean build and coverage:
**340 passed, zero failed, three expected Windows POSIX skips**. Coverage and
gates are unchanged; `git diff --check` passed. Resource, Docker and other-platform
checks were not rerun for this type-only change.

## Remove the total file-byte cap (2026-11-13)

Tested base `c4867e30b313728de03499c2dbceb787afd6d88f` plus the working-tree
S16 correction, on native Windows x64 / Node 24.22.3. The existing route now
sets multipart `fileSize` to positive infinity explicitly; omitting it would
inherit Fastify's finite body limit. `MAX_FILE_BYTES` / `maxFileBytes`, the
file-limit truncation branch and resource-check size overrides are removed.
The local concurrency limit and settled-work lifetimes are unchanged. The
active-upload getter now explains its use as the preferred Kubernetes HPA custom
metric with a target below the cap; no metric endpoint or HPA configuration was
added. Current operational docs and S10/S16 describe the resulting contract.

Before implementation, the new lazy real-HTTP regression failed with **413
instead of 200**. It sends 105,324,000 valid file bytes (12,000 copies of the
unchanged, independently established 21-frame fixture) without a size override.
After implementation it passes with exactly **252,000 frames** and releases
admission. The focused upload/configuration/error/admission run passed 90 tests.

Intentional assertion changes remove seven obsolete file-byte configuration
rejection cases and one file-size dependency-error mapping. A new test confirms
the removed environment setting no longer affects startup configuration. The
former capped-upload recovery case keeps its trailing-junk input and successful
follow-up upload, now correctly expecting invalid-media 400. All three multipart
count-limit classifications and real-HTTP structural limits remain covered.
Fixtures, dependency pins, coverage gates/exclusions and unrelated checks are
unchanged; the resulting full-suite count is six lower than the prior 340.

Self-review using `review-change` inspected the complete correction, config and
route callers, plugin defaults, success/invalid input, cancellation, overload,
stream settlement, resource-check arguments and changed test expectations.
No findings remain. `git diff --check` passed. `npm.cmd run verify` passed lint,
strict typecheck, clean build and coverage: **334 passed, zero failed, three
expected native Windows POSIX-signal skips**, across 20 files. Coverage was
**95.65% statements**, **93.70% branches**, **97.70% functions** and
**97.52% lines**. The skipped signal cases require Linux/macOS signal delivery;
their execution is not claimed here.

`npm.cmd run test:resources` passed through the normal `dist/server.js` with no
file-size override: **536,871,536 bytes** returned exactly **1,284,528 frames**,
with liveness healthy afterward. Actual execution was **2026-11-13
00:24:13.600–00:24:15.306 UTC**; the report records `workingTreeDirty: true`.
Server baseline RSS was 75,608,064 bytes, server OS peak RSS **93,024,256 bytes
(about 88.7 MiB)**, and 53 observations remained below the 256 MiB ceiling.
Separate client peak RSS was 75,071,488 bytes. These observations describe this
test input, not production throughput or a universal memory guarantee.

`npm.cmd run test:resources:container` was attempted and reported **unavailable**:
`spawn docker ENOENT`. No container ran. Other-platform and hosted checks were
not executed; earlier qualified evidence remains historical. These measurements
were taken from the uncommitted correction. No push was performed.

## Schema-based configuration (2026-11-13)

Tested base `9de05f879d4e5013090a54a021dce6ed8bb5d026` plus the working-tree
S17 correction, on native Windows x64 / Node 24.22.3. Added production dependency
`env-schema` 8.0.1 with its lockfile entry; existing dependency versions did not
change. Both environment and programmatic configuration use typed JSON schemas
with shared properties. The custom decimal, range, host and log-level validation
helpers are removed; `AppOptions` derives from `Partial<AppSettings>`.

Defaults, immutable results, pre-Fastify configuration and standalone healthcheck
reuse remain. `env: false` prevents the library from merging ambient process
values with explicit data. Numeric values use normal coercion, while declared
port/admission/timer ranges and log levels remain. Host interpretation belongs
to the listener, with only a nonempty string constraint in the schema.

Four accepted-coercion cases (`+1`, `1e3`, leading/trailing whitespace) failed
against the custom decimal parser before implementation and now pass. Their
former rejection expectations became acceptance checks. Two bespoke host
rejection cases were removed under the explicit S17 policy; the empty-host case
remains. Tests now expect the library's errors instead of custom messages or
`RangeError`. Compiled startup tests continue to prove private invalid values
are absent from output. An added ambient-environment isolation regression and
three non-finite admission/timer cases bring the configuration file to 33 tests
and the full suite from 334 to 336 passing cases.

Qualification reproduced an actual dependency issue: Ajv 8.20.0 coerces
`Infinity` / `-Infinity` strings into non-finite values and bypasses ordinary
numeric bounds. This matches upstream
[ajv-validator/ajv#2626](https://github.com/ajv-validator/ajv/pull/2626).
The retained infinity-port test initially failed. One shared declarative `allOf`
integer check closes that gap for all numeric configuration without custom
validators, custom Ajv options or dependency patches. The focused configuration
and application-error run then passed **57 tests**.

Self-review with `review-change` inspected the full diff, shared schema/type
consistency, coercion and bounds, environment isolation, immutable input/output,
startup/logging/healthcheck callers, Docker production dependency installation
and intentional assertion changes. The non-finite coercion finding is resolved;
no review findings remain. Parser, upload/concurrency/deadline lifetimes, fixture
oracles, gates and coverage exclusions are unchanged.

`npm.cmd run verify` passed lint, strict typecheck, clean build and coverage:
**336 passed, zero failed, three expected native Windows POSIX-signal skips**,
across 20 files. Coverage: **95.54% statements**, **93.26% branches**,
**97.59% functions**, **97.47% lines**. Existing compiled-process startup,
configuration-failure privacy, probes and real-HTTP regressions passed, including
the lazy upload above the former 100 MiB cap. `git diff --check` passed.
Resource/container/other-platform checks were not rerun for this configuration
correction; the prior Docker-unavailable qualification remains. Tests were run
on the uncommitted correction; no push was performed.

## Free-format readability (2026-11-13)

Tested base `bb7b9e3271012af0b3519a8333625aee42d5cb7d` plus this working-tree
refactor, on native Windows x64 / Node 24.22.3. Free-format behavior and S05/S06/S09
remain unchanged. `inferFreeLength` now names header start/end positions, padded
distance and unpadded size. Its result uses `unpaddedBytes` / `nextHeader`, with
the existing counter updated to show the padding calculation and header reuse.
`isCompatibleFreeHeader` separates format compatibility from scanning;
`HeaderWindow` owns the fixed rolling four-byte state and its optimized bit
operations. Budget names now identify inference runs and candidate positions.

Comments and the MP3 guide explain bitrate index zero, CRC/channel overhead,
padding with a worked 501-minus-1 example, first-boundary commitment, whole-stream
budgets and the already-consumed next header. No new framing rule, dependency,
transport policy or application entrypoint was introduced.

The original 23 free-format cases passed before refactoring. A simpler copying
window also passed, but a diagnostic focused run took 1155 ms against 296 ms for
the original cases, so the final helper retains the bit operations. The final
focused run passed those same 23 cases in 395 ms. These single-run observations
guided the implementation choice; they are not a controlled benchmark or a
production throughput claim. Synchronous bounded chunk scans, reader checkpoints,
fixed retained state and all existing limits remain.

Added three format-level cases split the next header after byte one, two and
three following a padded 501-byte first frame; each must count exactly three
frames. Existing expected answers and fixture bytes/hashes remain unchanged.
The full gate passed the real free-format fixture, exact inference distance and
search/run budgets, false-boundary commitment, padding/overhead, rate/indexed
transitions, truncation, cancellation, all other fixtures and HTTP/process checks.

Self-review using `review-change` inspected the complete diff and caller, window
carry across chunks, position arithmetic, exact-limit ordering, budgets and
stream/cancellation ownership. No findings remain. The three split cases add
coverage without changing existing oracles, thresholds or exclusions.
`npm.cmd run verify` passed lint, strict typecheck, clean build and coverage:
**339 passed, zero failed, three expected native Windows POSIX-signal skips**
across 20 files. Coverage: **95.61% statements**, **93.29% branches**,
**97.67% functions**, **97.51% lines**. `git diff --check` passed.
Resource/container/other-platform checks were not rerun for this refactor;
their earlier qualifications remain. Tests were run on the uncommitted correction;
no push was performed.

A subsequent comments-only second pass reviewed all of `free-format.ts` against
the implementation, counter and reader. It explains why streaming's small retained
state still needs CPU/search limits, the distinct distance/restart/combined-work
budgets, whole-stream accounting, and their distinction from MPEG requirements,
upload-size limits and buffer sizes. It also explains CRC/side information,
padding, consumed-header ownership, chunk boundaries, cancellation/yielding,
first-boundary commitment and the rolling window's sync/unsigned operations.
No findings remain. Executable code and limit values were unchanged in this pass;
Biome and `git diff --check` passed. Runtime tests were not rerun for these comment
edits; the 339-pass result above is the preceding refactor's execution evidence.

## Directory readability assessment (2026-11-13)

Reviewed all six files in `src/mp3/` on base
`bb7b9e3271012af0b3519a8333625aee42d5cb7d` plus the existing, uncommitted
free-format readability changes. Three parallel read-only reviews covered
metadata, orchestration/header/error, and stream/free-format responsibilities.
The assessment used `review-change`, the selected requirements, current guides,
callers and parser tests. No parser source or test expectations were changed
during this assessment. Findings below concern maintainability; no functional
defect was established.

Open findings, in recommended order:

1. **Medium — metadata contracts and backward search** (`tags.ts:22`, `:104`,
   `:134`). Explain already-consumed prefix bytes, before/after-audio policy,
   return outcomes, footer-only suffix buffering and the search back to offset
   zero. Rename ambiguous offset/stack helpers and explain remembered malformed
   candidates. This is the least approachable module for a format newcomer.
2. **Medium — implicit parser phases and consumption** (`count.ts:15`, `:31`,
   `:43`). Make leading metadata/audio/trailing metadata transitions apparent;
   clarify that the saved next header is already consumed and that inference
   already completed the frame counted in its branch. Prefer clearer names and
   small local explanations before introducing a new state abstraction.
3. **Medium — MPEG field decoding** (`header.ts:20`, `:33`, `:41`). Name decoded
   fields and explain accepted/reserved bit values, CRC and mono/stereo overhead,
   the bitrate-zero marker and the length formula. Document returned byte units
   and `undefined`; retain the useful discriminated union.
4. **Medium — reader API/ownership contracts** (`reader.ts:27`, `:52`, `:64`,
   `:89`, `:108`). Explain peek versus consume, consumed versus fetched position,
   partial reads at EOF, borrowed versus copied results, exact skip and iterator
   closure. Explain/name descriptor, progress and empty-pull bounds; retain bulk
   processing and cooperative cancellation without adding per-byte promises.
5. **Medium — metadata size semantics and policy limits** (`tags.ts:4`, `:47`,
   `:145`, `:176`, `:202`). Explain bounded unknown-tail memory versus streamed
   declared tags, ambiguity-work limits and yielding after EOF. Distinguish ID3
   payload length from APE size including its footer; use verb-led decoder names
   and name the remaining ID3 sizes/flags rather than opaque literal arithmetic.
6. **Low — free-format naming consistency** (`free-format.ts:16`, `:25`, `:106`).
   Names should identify unpadded frame bytes, searched positions and a candidate
   header before acceptance. The educational comments now explain the algorithm,
   ownership and safety policy well; further expansion is not the priority.

The six-file separation is appropriate: traversal, header decoding, stream
cursor, free-format inference, metadata and shared domain error each have a clear
owner. Keep `HeaderWindow` local and retain the tiny shared error module. Improve
metadata's internal structure/contracts first. If format rules later grow enough
to justify splitting, pure ID3 and APE descriptor modules can serve both forward
and backward paths; avoid circular suffix/tag imports, generic utility modules,
per-function files or a parser framework. File count alone is not the problem.

TypeScript foundations are sound: strict compilation, a real header discriminant,
readonly fields, private mutable state, typed asynchronous input and narrowed
unknown exceptions. No unsafe `any`, non-null assertions or broad casts need
removal. Prefer semantic names, small literal unions where useful and explicit
contracts over more generic layers or branded numeric types.

Findings remain open because this request was an assessment. `npm.cmd run verify`
was rerun on the reviewed working tree and passed lint, strict typecheck, clean
build and coverage: **339 passed, zero failed, three expected native Windows
POSIX-signal skips**, across 20 files. Coverage remained **95.61% statements**,
**93.29% branches**, **97.67% functions**, **97.51% lines**. This verifies existing
behavior, not newcomer comprehension. Resource/container/other-platform checks
were not rerun; their prior qualifications remain. No commit or push was made
as part of this assessment.

## Directory readability implementation (2026-11-13)

Tested base `bb7b9e3271012af0b3519a8333625aee42d5cb7d` plus the existing pending
free-format changes and this working-tree correction, on native Windows x64 /
Node 24.22.3. The six findings from the directory assessment are resolved within
the existing six modules; `error.ts` remains unchanged. No format policy, numeric
limit, error response, fixture expectation, dependency or test gate was changed.

Disposition of the assessment findings:

1. `tags.ts` now exposes `consumeMetadata` with `continue` / `end-of-stream`
   outcomes. Its contract describes the already-consumed prefix, leading/trailing
   policy and the caller's obligation to remain in metadata after audio.
   Backward validation names its pending end offsets, candidate starts and saved
   malformed interpretation, and explains exclusive offsets and complete coverage.
2. `count.ts` names three phases with a small literal union. The phase enters
   audio only after a completed frame; trailing metadata is sticky. Names and
   branch comments explain already-read headers, inferred frame consumption and
   frame byte counts. The public API documents format, ownership and errors.
3. `header.ts` names the decoded MPEG fields, explains accepted/reserved values,
   padding/CRC/channel overhead and the formula, and documents undefined results.
   A shared four-byte width avoids repeated format literals; `FrameHeader` keeps
   its existing discriminated shape. A local copy of that width in the per-byte
   window avoids repeated module-property access in transformed test execution.
4. `reader.ts` names chunk offset, consumed stream position and bytes since yield.
   Its contracts explain sequential access, peek/consume, borrowed/copy results,
   short EOF reads, exact skips, cancellation checkpoints and iterator release.
   Descriptor and empty-pull bounds now have names and reasons, with no new checks.
5. Metadata safety comments distinguish unknown-tail memory from ambiguity CPU
   work, and explain yielding after EOF. Named ID3 descriptors/flags and a typed
   version table replace literal arithmetic and the nested flag-mask expression.
   ID3 payload size and APE size including footer are explicit; decoded APE
   `hasHeader` remains a declaration that must be validated against the pair.
6. Free-format names identify maximum unpadded frame bytes, searched positions and
   a candidate header before acceptance. Existing explanatory comments remain.

Three parallel implementation tasks had disjoint source ownership. Subsequent
cross-reviews with `review-change` checked counting transitions, first-boundary
commitment, exact limits, header masks, ID3 masks, APE/ID3 sizes, candidate order,
error propagation, copies and stream/cancellation ownership. Two minor wording
findings were resolved: binary channel-mode values are explicit and API comments
distinguish metadata contents from the descriptors that are decoded/validated.
No review findings remain. Guides explain the module tour, phases, metadata
outcomes and backward validation. Earlier assessment/evidence entries remain
historical rather than being rewritten to claim prior resolution.

Strict typecheck and focused parser/fixture execution passed **149 tests across
seven files**. `npm.cmd run verify` then passed lint, strict typecheck, clean
compilation and coverage: **339 passed, zero failed, three expected native Windows
POSIX-signal skips**, across 20 files. Coverage was **95.77% statements**,
**93.19% branches**, **97.67% functions**, **97.27% lines**. Fixtures, assertions,
thresholds and exclusions were preserved. Final wording-only edits were checked
with Biome and `git diff --check` after the full gate.

`npm.cmd run test:resources` passed using the existing `dist/server.js`:
**536,871,536 lazy file bytes** returned exactly **1,284,528 frames**, with
liveness healthy. Actual execution: **2026-11-13 01:58:33.983–01:58:35.815 UTC**.
The report records `workingTreeDirty: true`, server baseline RSS 79,908,864 bytes,
server OS peak RSS **92,688,384 bytes (about 88.4 MiB)**, 57 observations and the
unchanged 256 MiB ceiling. Separate client peak RSS was 75,141,120 bytes. This is
resource-regression evidence for that input, not a production benchmark.
Docker and other-platform checks were not rerun; previous qualifications remain.
The correction remains uncommitted at the time of verification; no push was made.

## Original assignment scope assessment (2026-11-13)

Reviewed all four pages of `docs/assignment.pdf` and the parser on clean
`41ce745a44dc47cbe89d75a2d875b34e30408aac`. The PDF requires logical MPEG-1
Layer III frame counting, TypeScript, no direct MP3 parsing dependency and correct
JSON, with readability, errors, large-file handling and performance as evaluation
criteria. It explicitly excludes other MPEG formats. It does not explicitly
require APE versions, metadata-chain ambiguity handling or a metadata validator;
its five-day guidance prioritises a working, understandable solution. The local
002/005 metadata requirements describe later repository scope, not additional
requirements found in the original PDF.

The count/header traversal, per-frame indexed CBR/VBR sizes, padding, physical
carrier counting, rejection of unsupported versions/layers, stream cursor and
small domain error are justified by the assignment and the later streaming
request. Free-format remains a MPEG-1 Layer III variant; its discovery step is
not automatically excluded by the prohibition on other MPEG formats. Its exact
search caps, candidate-confirmation policy and code organisation are local
implementation choices, not assignment requirements.

The sample has a leading ID3v2.4 header declaring 34 body bytes, placing audio at
offset 44; it does not require APE handling. Common metadata skipping prevents
metadata from being counted as audio. APEv1/v2, paired leading/trailing APE,
appended paired ID3v2.4, stacked mixed tags, strict descriptor conformance and
unknown-tail backward ambiguity search are additional compatibility scope.
`consumeUnknownSuffix`, `validateMetadataSuffix` and `findTagStartCandidates`
are the strongest simplification candidates if footer-only/mixed metadata
compatibility is intentionally dropped. The associated limits and checkpoints
protect resources for those features; they do not independently justify retaining
them. The code validates metadata envelopes, not item values or compressed audio.

APE metadata does not change the underlying audio's MPEG version/layer. Removing
APE support can reject otherwise valid MPEG-1 Layer III audio files carrying
those tags, so a narrower supported-input contract must be stated explicitly.
Likewise existing free-format commitment and resource limits do not prove
universal MPEG conformance. The assessment recommends retaining the core counter,
efficient streaming, common ID3 handling and error boundaries, and making an
explicit compatibility choice before deleting APE/ambiguous-footer support.
No parser or test changes were made; scope choices remain recommendations.

Two parallel read-only reviews checked parser and metadata scope. The focused
parser/fixture command passed **149 tests across seven files**, including the
unchanged sample's **6090 frames**, all committed fixture identities and counts,
and unsupported MPEG-2 rejection. The full gate, resource and container checks
were not rerun for this read-only assessment. This entry records findings rather
than claiming additional implementation or universal-format coverage.

## Count-only metadata correction (2026-11-13)

Implemented the user's approved simplification as S18/T09 in the owning feature.
Tested the uncommitted working tree based on
`41ce745a44dc47cbe89d75a2d875b34e30408aac`, with Node **24.22.3** and npm
**11.19.1**. The preceding scope-assessment entry was already uncommitted and is
preserved. No commit or push was made.

Forward ID3/paired APE traversal now skips the declared extent, including any
declared footer, without inspecting or comparing footer fields. ID3 revisions
and unrelated flags, APE item counts, reserved bytes and unrelated flags no
longer cause rejection. ID3's footer flag adds bytes only for v2.4. Supported
ID3 headers without footers also work after audio. Backward suffix discovery
uses nullable extent candidates and header signatures; metadata-pair equality,
exception-based candidate handling and saved conformance errors are removed.
`consumeMetadata` returns void, and the counter observes EOF normally. `tags.ts`
shrinks from 327 to 247 lines; the existing six-module separation remains.

Seven new tolerance cases failed against the unchanged parser before source
changes. Strict-policy assertions were deliberately replaced with successful
counts, rather than removed wholesale. Additional cases retain failures for
unusable boundary fields, missing boundary signatures, truncated extents and
audio after terminal metadata. HTTP tests now accept differing ID3 footers and
nonzero APE reserved bytes, while truncated ID3/APE extents still return safe
400 responses and allow subsequent valid uploads. Fixture bytes/hashes/counts,
coverage thresholds and exclusions are unchanged; the supplied sample remains
**6090** physical frames.

Applied `review-change` to the complete diff, affected stream-reader and upload
callers, tests and current guides. Checked forward/backward length ownership,
v2.4-only footer interpretation, full suffix coverage, candidate preference,
fixed budgets, post-EOF cancellation, reused producer chunks, iterator release
and unchanged request/admission ownership. Review resolved misleading strict
test descriptions and tag-only rejection cases that could pass simply because
no audio existed; those tolerance cases now include actual counted frames.
An EOF regression proves suffix processing does not pull the source twice after
EOF and still returns its iterator once. No unresolved findings remain.

The existing first-boundary policy and resource bounds remain compatibility
limits. Relaxing footer candidates can increase overlapping interpretations;
fallback and ambiguity-budget tests pass, but arbitrary adversarial layouts are
not promised. Incorrect declared lengths can still obscure audio; this change
does not add recovery or metadata conformance certification. Current guides
state these limits and distinguish them from assignment requirements.

Focused parser/fixture execution passed **167 tests across seven files** before
the final six boundary/EOF cases were added. The final `npm.cmd run verify`
passed lint, strict typecheck, clean build and coverage: **365 passed, zero
failed, three expected native Windows POSIX-signal skips**, across 20 files.
Coverage: **97.94% statements, 96.08% branches, 97.59% functions, 99.23% lines**.
An initial Markdown table-format failure was corrected before the passing gate.
The three skips remain the existing platform guard: Windows child termination
cannot exercise the JavaScript POSIX shutdown handlers.

After that build, `node scripts/resource-check.ts` passed using the normal
`dist/server.js`: **536,871,536 lazy file bytes**, independently expected
**1,284,528 frames**, healthy liveness, 53 memory observations and server OS
peak RSS **92,930,048 bytes (about 88.6 MiB)** under the unchanged 256 MiB
ceiling. Baseline RSS was 79,020,032 bytes; separate client peak RSS was
73,629,696 bytes. Actual execution: **2026-11-13 04:21:54.112–04:21:55.824 UTC**;
the report identifies the base revision and `workingTreeDirty: true`.
This measures the tested lazy input, not general production throughput.
Docker and other-platform checks were not rerun; prior qualifications remain.

## Upload directory readability

Reviewed and cleaned up all four `src/upload/` modules in the uncommitted working
tree based on `b6d0cd8778155e7736e2f26edce84a039efec187`, using Node **24.22.3**.
Extracted file counting and stream cleanup into a private `countFile` helper so
multipart validation and HTTP completion remain easy to follow. Named the
rejected-body byte limit and clarified local promise/byte-counter names. Tightened
comments to explain synchronous admission, safe errors, cancellation, stream
settlement and the difference between responding and releasing capacity.

Applied `review-change` to the complete maintenance diff and affected callers
and tests. Success, invalid parts, early parser failure/return, overload,
deadlines, disconnects, rejected-body cleanup and application drain retain their
existing behavior. No unresolved findings remain. No contract, fixture, test,
coverage threshold or deployment setting changed; existing regression tests
exercise the extracted stream lifecycle without adding implementation-only tests.

`npm.cmd run verify` passed lint, strict typecheck, clean build and coverage:
**365 passed, zero failed, three expected native Windows POSIX-signal skips**,
across 20 files. Coverage: **97.95% statements, 96.08% branches, 97.61% functions,
99.23% lines**. Final edits after that gate only polished comments and added this
record. Heavy resource checks, Docker checks and other-platform execution were
not rerun for this behavior-preserving cleanup. No commit or push was made.

## Test suite review (2026-11-13)

Reviewed all 20 test modules, the shared helpers and fixture documentation in the
working tree based on `c53432e67ee6b46df82c38b9a949b2da937ff3e9`, using pinned
Node **24.22.3** and Vitest **5.1.0**. This is maintenance within the existing
feature; no service contract, production source, fixture bytes/manifest, framework
pin, coverage threshold, exclusion or platform skip changed. Updated
`docs/testing.md` with helper responsibilities and testing conventions.

Applied `review-change` to the complete diff, checking test intent against the
parser, transport, runtime and ownership contracts. Findings and dispositions:

- Consolidated four copies of promise-deadline handling into `helpers/async.ts`
  and repeated raw HTTP response/multipart construction into `helpers/http.ts`.
  Node's `stream/consumers.text` replaces hand-written response accumulation.
  The single-observation timeout remains explicit because retrying a rejected
  promise would change the evidence. App/process scopes still own cleanup.
- Replaced the barrier wrapper with native `Promise.withResolvers`, state
  assertion wrappers with `expect.poll`, log-event listener management with
  `vi.waitUntil`, and the custom first-call failure counter with a Vitest mock.
  Environment restoration uses `afterEach`; application-option tests now live
  with configuration tests. Admission tests assert that permits exist before
  using them instead of silently skipping calls through optional chaining.
- Replaced the epilogue's fixed 50 ms sleep with parser progress, an event-loop
  turn, retained-capacity assertions and HTTP completeness at response finish.
  Real deadline fixtures now allow one second for setup/progress on busy workers;
  they retain cancellation, response, recovery and unsettled-work assertions.
- Privacy checks await both upload and unmatched-route completion records before
  inspecting captured output. Child event waits classify missing events only
  after stdio closes, and malformed complete JSON lines now fail rather than
  being silently ignored. Synchronous Biome child invocations have a native
  timeout because they block Vitest's own timeout callback.
- Free-format bounds retain their independent boundary cases and assert the
  domain error type rather than incidental wording. The distance case also
  measures input delivery, allowing only the documented 128 KiB plus one chunk.
  The metadata ambiguity reason assertion remains because generic malformed
  rejection would not prove that its work budget was exercised.

No unresolved findings remain. Retained the real HTTP/process fixtures, explicit
ownership barriers, independent literal framing vectors and all six real-audio
identities/counts. Five unexpected-error inputs previously checked in one loop
now report as separate `it.each` cases, accounting for the increased test count.

A temporary mutation returned the first file's count without multipart/HTTP
completion. The revised epilogue test rejected it on prematurely released
capacity. The mutation was restored before final verification; there is no
production diff. Removing only the final HTTP-body await had not reproduced an
early success because multipart iteration also waits for input completion.

The final `npm.cmd run verify` passed lint, strict typecheck, clean build and
coverage: **370 passed, zero failed, three expected native Windows POSIX-signal
skips**, across 20 files. Coverage remains **97.95% statements, 96.08% branches,
97.61% functions, 99.23% lines**. A separate shuffled run of multipart, upload
lifecycle, compiled-process and configuration tests with seed **20261113** passed
**95 tests**, with the same **three skips**, across four files. Final changes
after the full gate only add this record. Heavy resource checks, Docker and
other-platform execution were not rerun; the existing platform qualifications
remain. No commit or push was made.

## Logging scope correction (2026-11-13)

Implemented S19 in the uncommitted working tree based on
`ea4f684e2fc6f8c3cd31d889d47ee50bfbd932cb`, with pinned Node **24.22.3** on
native Windows. Removed 004 O04, the log-content invariant in `AGENTS.md`,
startup-error redaction, and `src/logging.ts`. Fastify now uses its standard
Pino logger and request logging at the configured level. Native logger calls
retain startup/shutdown and unexpected upload-failure events, including error
details where available. Current architecture, operations and testing docs agree
with the unrestricted logging policy; earlier verification remains historical.

Intentional check changes: deleted the 26-case logging unit suite and the compiled
trace-privacy case. Removed privacy-only assertions from startup validation,
malformed multipart and late parser-failure cases while retaining their functional
assertions. Removed the obsolete deleted-module import restriction and its harness
case; parser independence rules for existing modules remain. No fixture, coverage
threshold, coverage exclusion or platform skip changed.

Applied `review-change` to the complete correction, including affected callers,
checks, specs and current guidance. Startup errors, normal HTTP handling, invalid
multipart, cancellation, late failures, overload and shutdown ownership retain
their functional contracts. Process/resource observers still receive the actual
bound port through `server_started`. No unresolved findings remain.

A source-level smoke command logged an arbitrary message with extra fields and
a child logger with an error: before the change it emitted no records; afterward
both records included their message, extra fields, child context and exception
details. A compiled-app HTTP smoke returned 200 and emitted standard request and
completion logs, including the raw query string and generated request ID.

The first full-gate attempt stopped on formatting in changed files. After applying
the configured formatter, `npm.cmd run verify` passed lint, strict typecheck,
clean build and coverage: **342 passed, zero failed, three expected native Windows
POSIX-signal skips**, across **19 files**. Coverage: **98.16% statements, 95.45%
branches, 100% functions, 99.58% lines**. Final edits after this gate update only
the specification wording, completed task and this record. Heavy resource checks,
Docker and Linux/macOS execution were not rerun. No commit or push was made for
this correction.

## Upload directory readability (2026-11-13)

Reviewed and documented all four `src/upload/` modules in the uncommitted working
tree based on `0f1a62789b1a5f32532d7a36105086fa7930a723`, using pinned Node
**24.22.3** on native Windows. Clarified application/request ownership, immediate
admission, idempotent permit release, cancellation versus work settlement,
multipart/HTTP completion, safe error classification and bounded rejected-body
cleanup. Renamed internal lifecycle state, the deadline timer, request-lifetime
map, discard callback and counter parameters to describe their roles. Control
flow, public APIs, response contracts, limits and fixtures are unchanged; no
acceptance amendment or new regression was needed for these comments and renames.
Existing edits in `src/config.ts` and `src/server.ts` were left untouched and were
present during verification.

Applied `review-change` to the complete upload correction and inspected its app
caller and existing admission, rejection, multipart, lifecycle and compiled-process
evidence. Followed success, invalid input, overload, deadline, disconnect and
cleanup paths, including a counter that returns early or settles after timeout.
No unresolved findings remain. No checks, expectations, coverage exclusions or
thresholds changed.

`npm.cmd run verify` passed lint, strict typechecking, clean build and coverage:
**342 passed, zero failed, three expected native Windows POSIX-signal skips**,
across **19 files**. Overall coverage: **98.16% statements, 95.45% branches,
100% functions, 99.58% lines**; upload coverage includes **100% lines and
functions**. `git diff --check` also passed. For this upload cleanup, only this
evidence entry was added after the full gate. Heavy resource checks, Docker and Linux/macOS execution
were not rerun. No commit or push was made for this cleanup.

## Server readability cleanup (2026-11-13)

Reviewed `src/server.ts` and its application, configuration, admission and
compiled-process callers in the uncommitted working tree based on
`0f1a62789b1a5f32532d7a36105086fa7930a723`, using pinned Node **24.22.3** on
native Windows. Named the one-second shutdown settlement allowance, clarified
signal-handler/state/timer names and used consistent named local functions.
Comments now explain when `runServer` resolves, asynchronous signal handling,
repeated-signal behavior, referenced deadlines, socket-triggered cancellation,
actual bound-port reporting and preservation of the original startup error.

Applied `review-change` to the complete maintenance diff and relevant lifecycle
contracts. Startup success/failure, graceful close, forced cancellation, final
exit timing and handler/timer cleanup retain their behavior. No unresolved
findings remain. This server cleanup changes no specification, test, fixture,
logging policy, configuration, coverage threshold, exclusion or deployment
setting; existing functional tests cover the preserved behavior. Concurrent
`src/config.ts` edits and their separate verification record were left untouched.

`npm.cmd run verify` passed lint, strict typecheck, clean build and coverage:
**342 passed, zero failed, three expected native Windows POSIX-signal skips**,
across **19 files**. Coverage: **98.16% statements, 95.45% branches, 100%
functions, 99.58% lines**. Final edits after the gate add one explanatory comment
and this record. Real POSIX signal delivery, Docker and heavy resource checks
were not rerun. No commit or push was made for this cleanup.

## Configuration readability cleanup (2026-11-13)

Reviewed and cleaned up `src/config.ts` in the uncommitted working tree based on
`0f1a62789b1a5f32532d7a36105086fa7930a723`, using pinned Node **24.22.3** on
native Windows. Named the shared timer ceiling and integer schema; documented
configuration ownership, units, logging defaults, ephemeral ports, standard
coercion, immutable snapshots, validation errors and environment isolation.
Defaults, constraints, exported types and observable behavior remain unchanged.

Applied `review-change` to the maintenance diff and inspected the app, listener,
healthcheck, configuration tests and installed env-schema implementation. Retained
the post-coercion Infinity guard, explicit `env: false`, shared schema constraints
and runtime freezing. No unresolved findings remain. No tests, fixtures, coverage
settings or acceptance requirements changed; existing configuration regressions
cover the preserved behavior. A concurrent `src/server.ts` edit was observed and
left untouched; this review makes no completion claim for that separate edit.

`npm.cmd run verify` passed lint, strict typecheck, clean build and coverage:
**342 passed, zero failed, three expected native Windows POSIX-signal skips**,
across **19 files**, including all **42 configuration tests**. Coverage remained
**98.16% statements, 95.45% branches, 100% functions, 99.58% lines**. The tested
`src/config.ts` SHA-256 is
`38704df53aa9874376539a6ad31fd9edf6cb5a7c74d6f7f287ca91cc162b088b`.
Only this evidence record was added afterward for this cleanup. Heavy resource
checks, Docker and Linux/macOS execution were not rerun. No commit or push was made.
