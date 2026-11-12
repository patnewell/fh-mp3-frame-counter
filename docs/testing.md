# Testing and review

Use the pinned Node version and the explicit [platform command table](development.md).
The complete `verify` command lints, typechecks, performs a clean build and runs
Vitest with V8 coverage. Unit-only runs do not need a build; integration/all-test
scripts build first. Normal tests need no encoder, database or Docker daemon.

## Evidence by boundary

| Location                                        | Purpose                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/mp3/`                               | Pure headers, physical traversal, metadata, free-format ambiguity, reader limits and cancellation                  |
| `tests/unit/upload/`                            | Admission isolation/idempotence/drain, option validation and safe error classification                             |
| `tests/unit/config.test.ts`, `logging.test.ts`  | Shared immutable configuration and actual root/nested-child log privacy at configured levels                       |
| `tests/unit/harness.test.ts`                    | Exercise the actual Biome import boundary and verify official Lean skill hashes                                    |
| `tests/integration/fixtures.test.ts`            | Hash and independently established results for real MP3s, plus a 71,901,184-byte real-audio traversal              |
| `tests/integration/upload.test.ts`              | Real listening HTTP service, all fixtures, metadata, errors, storage failure/recovery and disposal                 |
| `tests/integration/multipart.test.ts`           | MIME normalization, boundaries, encoding, multipart truncation and HTTP-body completion                            |
| `tests/integration/upload-lifecycle.test.ts`    | Real transport plus controlled count/disposal barriers for overload, cancellation, deadlines and settled ownership |
| `tests/integration/closing.test.ts`             | Real TCP keep-alive pipeline after `app.close()`, preserving the application's exact busy/draining response        |
| `tests/integration/operations.test.ts`          | Actual startup/storage probes, liveness, readiness recovery and saturation policy                                  |
| `tests/integration/readiness-ownership.test.ts` | Disconnected readiness filesystem work remains owned by application close                                          |
| `tests/integration/process.test.ts`             | Compiled startup/sample/health/privacy/failure behavior from an unrelated path, plus bounded shutdown              |
| `scripts/container-smoke.ts`                    | Actual Linux image build, runtime policy, probes, original upload, disposal and clean stop                         |

Parser tests that use private temporary files are component tests in a strict
taxonomy; the `unit` folder indicates their narrow scope, not a rule that every
dependency must be mocked. Pure header and admission tests supply conventional
unit coverage. Real-HTTP tests exercise multipart parsing, streams and sockets;
an injected HTTP response is not equivalent transport evidence.

## Independent inputs

The unchanged `sample.mp3` must yield 6,090 physical frames. The
[fixture manifest and guide](../tests/fixtures/README.md) preserve six real assets,
hashes and independent expectations. The application parser never establishes
its own oracle. Synthetic byte vectors isolate malformed framing and ambiguous
layouts; they supplement the real files.

The large-file test builds and parses audio in bounded blocks. It establishes
correct traversal, not measured peak RSS, throughput or fleet capacity. Do not
describe it as a production load benchmark.

## Deterministic asynchronous tests

Use explicit promise barriers to observe a counter or disposer that has started
but not settled. A timeout response and an aborted signal must leave capacity
occupied until that barrier is released. Test owners resolve barriers and close
sockets in `finally`; helpers own disposable directories and listening apps.

Real deadline tests need wall-clock timers, but assertions should await observable
events/state with a generous bounded wait. Avoid sleeps that merely hope a request
has reached a particular phase. The historical 50 ms epilogue observation is
supplemented by a deadline-driven case that proves parsing never starts before
the full HTTP body completes.

## Coverage and review

Thresholds are 90% statements, 85% branches, 90% functions and 90% lines over
`src/`. Executable `server.ts` and `healthcheck.ts` are the only exclusions;
compiled child-process tests cover their behavior separately. No threshold
or exclusion change should be hidden inside a behavior fix.

Vitest writes `reports/tests.json` and `coverage/` reports; these generated files
are ignored by Git. Read the active feature's verification record for its actual
tested revision and counts. Historical records remain accurate for their own
milestones instead of being rewritten with the final suite total.

Run the focused regression while implementing, then `$review-change` against the
whole feature diff and the complete gate after findings are resolved. Review test
oracles, weakened assertions, changed checks and ownership failures as carefully
as production source. Passing coverage does not prove a missing acceptance case:
the 002 review found an APEv1 defect after a green gate, reproduced it, added two
failing regressions and verified the correction.

## Process, platform and container checks

Process tests launch the compiled service with isolated temporary storage, ports
and environments from a directory containing spaces. They check safe startup
failure, original-sample counting, real malformed multipart traffic, privacy at
trace level and healthcheck refusal/non-ready/stagnant/trickling responses.
The probe deadline is absolute; trickling data must not keep it alive indefinitely.

An isolated disposal harness uses the existing operation seam and compiled
shutdown implementation. One case leaves disposal unsettled without a child timer
or IPC handle, proving that the final shutdown timer keeps Node alive and exits
unsuccessfully. Another throws a private cleanup error after cancellation and
checks safe operational evidence. Repeated signals originate in the parent.
POSIX signal assertions are explicitly skipped on native Windows; a Windows kill
does not provide equivalent graceful-shutdown evidence.

A separate POSIX readiness case queues a real storage probe behind a named FIFO
in an isolated one-worker Node threadpool. The parent releases that filesystem
barrier explicitly. This tests disconnected-client close ownership without timing
a CPU workload, patching filesystem APIs or adding a production-only seam. It
requires the standard `mkfifo` utility on Linux/macOS and is explicitly skipped on
native Windows; that skip concerns the test mechanism, not the application policy.

CI configures the same full gate on Ubuntu, macOS and Windows, using `npm.cmd`
on Windows, then a Linux container job. Pinned action revisions, read-only workflow
permissions and checkout with credential persistence disabled reduce supply-chain
exposure; they do not prove the workflow has executed or that branch protection
is enabled.

The Docker smoke is separate from normal tests. It creates unique owned resources,
checks its selected Linux engine, builds the pinned image and verifies the actual
restrictions (including a root-user write attempt against the read-only filesystem).
It checks original-sample 6090, disposal and clean stop before finally removing
its own image/container. Do not weaken a failed runtime check to an image-text
inspection; record an unavailable daemon as unexecuted.

## Known dependency qualification

With the pinned Fastify 5.12.8 / multipart 10.1.8 / Busboy 3.2.5 combination, an
isolated `app.inject` diagnostic of a truncated, over-limit second part has exposed
an unhandled part-stream error in the dependency's skip path. This is retained
dependency-risk evidence, not a newly executed injection result in this rebuild.
The permanent compiled-process suite sends both Content-Length and chunked
malformed second parts over real HTTP and checks safe rejection, process survival
and storage disposal. Those checks pass; they do not prove every injection or
production event ordering is safe.

No private dependency patch, global uncaught-exception handler or removed parser
limit hides the issue. Reproduce against a proposed upstream fix/upgrade in an
isolated process and rerun both real-wire cases before changing the pin.
Consult [release verification](verification.md) for precisely executed checks.
