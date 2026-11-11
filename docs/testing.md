# Testing and review

Use the pinned Node version and the explicit [platform command table](development.md).
The complete `verify` command lints, typechecks, performs a clean build and runs
Vitest with V8 coverage. Unit-only runs do not need a build; integration/all-test
scripts build first. Normal tests need no encoder, database or Docker daemon.

## Evidence by boundary

| Location                                     | Purpose                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/mp3/`                            | Pure headers, physical traversal, metadata, free-format ambiguity, reader limits and cancellation                  |
| `tests/unit/upload/`                         | Admission isolation/idempotence/drain, option validation and safe error classification                             |
| `tests/unit/harness.test.ts`                 | Exercise the actual Biome import boundary and verify official Lean skill hashes                                    |
| `tests/integration/fixtures.test.ts`         | Hash and independently established results for real MP3s, plus a 71,901,184-byte real-audio traversal              |
| `tests/integration/upload.test.ts`           | Real listening HTTP service, all fixtures, metadata, errors, storage failure/recovery and disposal                 |
| `tests/integration/multipart.test.ts`        | MIME normalization, boundaries, encoding, multipart truncation and HTTP-body completion                            |
| `tests/integration/upload-lifecycle.test.ts` | Real transport plus controlled count/disposal barriers for overload, cancellation, deadlines and settled ownership |

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
compiled process behavior is an operational-cycle responsibility. No threshold
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
