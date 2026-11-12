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

Implementation, full-gate, resource and complete-diff review results will be
recorded here after execution. No container execution, memory improvement,
throughput result or completed feature is claimed by this initial record.
