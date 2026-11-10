# 002 · Implementation plan

Start from the merged 001 milestone and retain `countFrames(path, signal?)` plus
`InvalidMp3Error`. The completed-file reader remains the ownership boundary.
Temporary staging supplies seek/replay without holding uploaded bytes in JS memory.

## Design

- Extend the header result to distinguish indexed and free-format frames and expose
  sample rate, padding and minimum framing length. Keep the indexed formula intact.
- Add `src/mp3/free-format.ts` for resumable candidate search and file-scoped work
  accounting. Store numeric offsets/header values, not captured scan buffers.
- Let `count.ts` retain iterative candidate checkpoints. A failing suffix retries
  an earlier choice with its saved count; a complete valid suffix commits the
  interpretation. Search candidate boundaries in ascending offset order and retry
  saved choices depth-first. Charge scanned positions and traversed frame extents,
  with 4,096 selections and 8× size work budgets.
- Evolve `tags.ts` to validate leading and terminal envelopes. Walk terminal chains
  backward from EOF with an explicit stack of alternative ends. Keep its 4,096
  alternative-choice allowance file-owned across repeated suffix checks; bound
  choices, not normal tag depth. Never trim tags before a frame boundary is established.
- Preserve separate error categories and cancellation. No domain import of HTTP,
  environment or upload policy is permitted.

## Evidence and risks

Add the unchanged 26,400-byte free-format asset to the manifest. Its retained
independent LAME 3.100 evidence is 22 frames at 1,200 bytes and 24,815 decoded samples plus
529 skipped delay samples = 22 × 1,152. LAME is unavailable for a new decode; fresh
checks establish its hash and boundary spacing, not newly executed decoder evidence.

Use synthetic vectors to isolate false sync candidates, variable padding/rates,
short-frame tag lookalikes, overlapping tag alternatives, invalid descriptors and
budget exhaustion. Preserve the existing real fixtures and large-file regression.
Add a real HTTP free-format upload so this remains an end-to-end capability change.

Seekable parsing makes the required backtracking tractable. A future streaming
design must establish equivalent compatibility or explicitly revise the contract;
silently rejecting free-format is not a transport-only refactor.
