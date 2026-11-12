# 003 · Verification

Date: 2026-11-11. Tested clean revision:
`4e0ba58b7615d833161a7ecc0a0561943cc091b4`.
Environment: Node 24.22.3, Linux x64. This is the request-resource milestone;
process/container behavior remains the next cycle.

## Executed evidence

- Before route implementation at `8402116`, a real HTTP acceptance probe held
  four uploads open and submitted a fifth. It incorrectly returned 200 instead
  of the newly specified 503, establishing the gap before implementation.
- Final `npm run verify` passed lint, strict typecheck, compiled build and coverage:
  **227 tests**, 13 files, 163 unit and 64 integration; no skipped tests.
- Coverage: statements 96.84%, branches 94.80%, functions 100%, lines 99.74%.
  Thresholds and executable-entry-point exclusions are unchanged.
- Thirteen new real-HTTP lifecycle cases establish default capacity, independent
  replicas, private paths, expiry during receiving/counting/disposal, disconnect,
  open epilogues, failure recovery and close/drain ownership.
- Controlled promise barriers prove that early timeout responses and abort signals
  do not free unsettled counting or disposal. A later upload remains rejected
  until those operations settle.
- Stream-level tests directly establish the rejection allowance. The initial
  implementation's `destroy()` allowed an extra prefetched chunk beyond the
  contract. Pausing before destruction fixes it; assertions enforce the allowed
  range without requiring a particular at-limit versus crossing-chunk strategy.
- All previous parser/fixture/HTTP/harness checks remain passing.

## Review and disposition

Planning review clarified the lifetime of nonadmitted busy/draining rejections,
Fastify's independent closing-response path, and the boundary between HTTP headers
and multipart-part headers. The amended plan selects `return503OnClosing: false`
so closing uploads reach the stopped-admission policy.

An independent agent applied `$review-change` to the completed implementation and
ran a real TCP keep-alive/pipeline probe of `app.close()`. The first request
returned 200 with 21 frames. The request sent on the same active connection after
close began returned 503, exactly `{"error":"The service is draining."}`, with
`Retry-After: 1` and `Connection: close`. Capacity returned to zero and close
resolved. No material review findings remain.

The lifecycle test author corrected an initial test expectation that required an
invalid stalled body to wait for deadline 503. The specified prompt 415/close is
valid. Large rejected-body HTTP tests prove connection completion; the separate
stream-level tests prove the byte bound. This distinguishes actual evidence from
an incidental passing response.

## Limits and sequence

Cancellation is cooperative, not CPU preemption or proof of completed filesystem
work. Failed removal/crashes can leave orphans; bounded disposable storage and
ingress controls are documented. No load/peak-memory benchmark, Docker execution,
native macOS/Windows run or hosted CI run is claimed.

Specification, plan and tasks preceded source implementation. This verified
feature is merged before selecting 004; historical 001/002 evidence is preserved.
Independent agent review is not human approval or measured team adoption.

## Native Windows regression correction (2026-11-12)

At base revision `b8e43ab8bf99b9aeffcc23308a371ff65f3273b7`, the README's
full gate on Windows with Node 24.22.3 reproduced one failure:
`closes an oversized rejected body without waiting for HTTP EOF` received
`read ECONNRESET` instead of a readable 415. U06 already permits the connection
to close before the response arrives; the test incorrectly required delivery.

The working-tree correction accepts only the exact 415 JSON or `ECONNRESET`.
It still requires bounded closure before client EOF, eventually released capacity,
no parser call or retained files, and a successful subsequent upload. The focused
lifecycle suite passed all 13 cases. Production behavior, acceptance, byte-bound
tests, fixtures and coverage gates are unchanged. Independent diff review found
no remaining issues. See the [004 follow-up](../004-operate-containerized-service/verification.md#native-windows-follow-up-2026-11-12)
for the full Windows gate and skip accounting; earlier milestone evidence above
remains historical.
