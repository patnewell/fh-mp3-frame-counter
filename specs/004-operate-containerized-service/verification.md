# 004 · Verification

Date: 2026-11-11. Tested clean revision:
`a67beed776cbeb663f44640f27f5081a4a46555d`.
Environment: Node 24.22.3, Linux x64. This is the final application milestone;
container/native/hosted qualification is stated separately below.

## Executed evidence

- Before implementation at `267f3d0`, a real HTTP readiness acceptance probe
  returned 404 instead of the newly specified 200.
- Final `npm run verify` passed Biome, strict typecheck, a clean compiled build
  and coverage: **318 tests**, 19 files, **225 unit/component and 93 integration**;
  no failures or skips on this Linux runner.
- Coverage: statements **96.99%** (516/532), branches **95.59%** (391/409),
  functions **97.64%** (83/85), lines **99.35%** (464/467). The thresholds and
  exclusions are unchanged: the two executable entrypoints are tested as
  compiled child processes, outside the V8 source-coverage set.
- All prior fixtures/parser/HTTP/lifecycle cases remain passing. The unchanged
  original sample returns 6090 in parser, listening HTTP and compiled-process
  tests. The 71,901,184-byte / 172,032-frame traversal passes.
- New runtime tests cover immutable validation, actual temporary-storage
  startup/readiness probes, liveness, saturation, storage recovery and private
  structured events. The 22 compiled-process cases run from an unrelated path
  containing spaces and exercise original upload, safe startup failures, trace
  privacy, real malformed multipart, silent absolute-deadline healthchecks,
  graceful drain, forced cancellation and the final unsuccessful exit bound.
- The stagnant and trickling healthcheck cases each completed at approximately
  2.06 seconds. The unsettled-disposal case reached its final bound despite
  repeated parent-originated signals. These are observed outcomes, not a
  production latency guarantee.
- The actual Docker smoke was attempted and failed its preflight with
  `spawn docker ENOENT`; no image or container checks ran.

The first final-gate attempt at `9142f0c` stopped at Markdown table formatting.
Commit `a67beed` applied the existing formatter without changing source, tests or
thresholds; the clean gate above is the subsequent successful run.

## Review findings and disposition

1. **Private child logger bindings.** A nested-child output regression exposed
   private context bypassing Pino's parent binding formatter. Safe events now
   serialize through the application-owned root logger. Actual nested output,
   arbitrary messages/objects, exact event fields and configured levels are tested.
2. **Disconnected readiness ownership.** Independent runtime review reproduced
   application close completing before queued probe filesystem work. The plan
   was clarified in `a562703`; `34be2af` captures the current probe before
   upload draining and awaits its settlement without swallowing failure.
   A new real-filesystem regression failed against an external archive/build
   of `294220c` because `closedBeforeRelease` was true, then passed against the
   correction. Its POSIX FIFO provides an explicit worker barrier; it uses no
   filesystem monkeypatch, timed CPU workload or production-only seam.
3. **Permanent closing contract.** The earlier independent TCP pipeline evidence
   is now a regression: a request on an active connection after close begins
   retains the application's exact 503 JSON, retry header and closing connection.
4. **New module boundary coverage.** Two import-policy cases initially passed
   forbidden parser imports of logging/healthcheck modules. Extending the actual
   Biome restriction made both cases reject as required. The independent-parser
   positive case and official Lean hashes remain checked.
5. **Operational wording.** Review corrected the distinction between the chosen
   15-second Docker launch timeout and Docker defaults, and between disabled
   credential persistence and credential-free checkout. Manual platform commands
   and image/smoke policy were checked against the implementation.

Independent agents applied the repository review workflow to runtime and
documentation. These findings are resolved; the dependency and environment
qualifications below remain. Agent review is not human approval.

## Qualifications and sequence

- Docker was unavailable. Native macOS/Windows and hosted CI were not executed.
  Three POSIX signal cases and one POSIX FIFO mechanism explicitly skip native
  Windows; no equivalent Windows signal evidence is claimed.
- The known multipart dependency skip-path issue remains qualified in
  [testing](../../docs/testing.md#known-dependency-qualification). Both permanent
  real-wire malformed-second-part process cases pass, without a global exception
  handler or weakened limits; they do not cover every dependency event ordering.
- No production load, peak-memory/tmpfs, ingress or fleet-scale measurement was
  performed. No human approval, team adoption or net delivery improvement is
  invented. [Team guidance](../../docs/development.md#team-use-and-human-ownership)
  describes how to establish those separately.
- Specification, plan and tasks preceded implementation. Source, tests and
  relevant documentation developed within this fourth cycle after 003's merge.
  Earlier evidence remains unchanged. The final archive is checked after merge
  and verified from its extraction; the delivery report identifies those results.

## Native Windows follow-up (2026-11-12)

Tested base revision `b8e43ab8bf99b9aeffcc23308a371ff65f3273b7` plus the
uncommitted lifecycle-test correction and accompanying documentation in this
working tree. Environment: native Windows x64, Node 24.22.3, npm 11.19.1.

- `npm.cmd ci --ignore-scripts` succeeded: 104 packages installed, zero reported
  vulnerabilities.
- Before correction, `npm.cmd run verify` passed lint, typecheck and build but
  failed one oversized-rejection test with `read ECONNRESET`: 313 passed,
  one failed, four skipped. The [003 correction](../003-bound-upload-resource-use/verification.md#native-windows-regression-correction-2026-11-12)
  aligns its response assertion with existing U06, preserving bounded disposal
  and adding parser/nonretention/recovery assertions.
- After correction, the focused lifecycle suite passed all 13 tests, then
  `npm.cmd run verify` passed lint, strict typecheck, a clean build and coverage:
  **314 passed, zero failed, four skipped**, across 19 files (18 passed,
  one wholly skipped). Coverage: 96.99% statements, 95.59% branches,
  97.64% functions and 99.35% lines. Thresholds/exclusions are unchanged.
- The four skips are the existing Windows conditions: three real POSIX shutdown
  signal cases and one readiness ownership case using a POSIX FIFO and SIGUSR2.
  README now identifies them before the manual upload instructions; the
  [testing guide](../../docs/testing.md#process-platform-and-container-checks)
  explains each mechanism. No new skips were added.
- Independent agent review applied `review-change` to the complete test/README/
  testing-guide diff against the base and found no remaining issues. The oracle
  permits only exact HTTP 415 JSON or `ECONNRESET`; closure, capacity, no parser/
  retained data, and subsequent recovery remain required. `git diff --check`
  passed. Agent review is not human approval.

Linux/macOS, Docker and hosted CI were not rerun for this follow-up. The earlier
Linux milestone, qualifications and delivery history above remain historical;
this working-tree check does not establish a new packaged release.
