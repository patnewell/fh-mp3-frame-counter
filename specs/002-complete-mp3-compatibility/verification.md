# 002 · Verification

Date: 2026-11-11. Tested clean revision:
`eb683cffb6002b392309d9b9a92fb9b311d2c02d`.
Environment: Node 24.22.3, Linux x64. This preserves the completed 002 milestone;
later cycles add request lifecycle and deployment behavior.

## Executed evidence

- Before implementation, the newly committed real free-format fixture test at
  `e9bd6f7` failed with an invalid MPEG header at byte zero. Its expected 22 frames
  came from the independent fixture evidence, not the new parser.
- Final `npm run verify` passed lint, strict typecheck, build and coverage:
  **187 tests**, 10 files, 136 unit and 51 integration; no skipped tests.
- Coverage: statements 97.38%, branches 96.29%, functions 100%, lines 99.63%.
  The existing executable-entry-point exclusions and thresholds are unchanged.
- All six real fixtures retain their independent results; the free-format asset
  returns 22 through both file parsing and a real HTTP socket.
- Regressions cover deterministic ascending/depth-first selection, full-layout
  fallback, changed padding/rates, payload tag lookalikes, 5,000 ordinary terminal
  tags, and all three file-owned search budgets. Exhaustion cannot be bypassed
  by retrying a later otherwise valid interpretation.
- The existing 71,901,184-byte / 172,032-frame traversal still passes.

## Review and disposition

An independent agent used `$review-change` and narrow counterexamples.

1. Planning review found that “first valid layout” needed explicit candidate
   ordering and that the metadata-alternative allowance needed an ownership scope.
   Commit `a12a7c6` clarified both before implementation completion.
2. Completed-source review reproduced a version-specific APE defect: v2-only
   header flags could make a fabricated paired v1 envelope appear valid. Two new
   regressions failed before the correction. The contract now explicitly selects
   strict zero-only v1 footer flags; `eb683cf` makes pairing v2-only.
3. Independent follow-up probes reject malformed paired/nonzero-flag v1 while
   accepting valid v1 and paired v2. No review findings remain.

The earlier clean gate at `5632e61` passed 185 tests; passing tests did not establish
that the missing APE regression was unnecessary. The final gate includes that fix.
This review is agent evidence, not human approval.

## Limits and sequence

The real free-format asset's identity/spacing were freshly verified; its LAME
authoring/decode evidence is retained, not a newly executed LAME run. Structural
counting does not validate compressed audio, CRC values or all metadata items.

Full admission/deadline behavior remains 003; process/container qualification
remains 004. Docker, native macOS/Windows and hosted CI were not executed.
Specification, plan and tasks precede implementation; this verified feature is
merged before selecting 003. Past milestone records remain unchanged.
