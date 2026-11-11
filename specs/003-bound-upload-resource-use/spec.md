# 003 · Bound upload resource use

## Outcome and relationship

Preserve the complete 001/002 counting and HTTP contracts while making a replica's
resource ownership explicit under overload, stalls, disconnects and failed
disposal. This cycle adds request lifecycle behavior; process configuration,
health endpoints and container deployment remain 004 work.

## Acceptance

| ID  | Observable requirement                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U01 | Keep all fixture counts, media compatibility, response shapes and existing 400/413/415/500 behavior. Add 503 for busy, draining and expired uploads; busy/draining include `Retry-After: 1`.                                                                               |
| U02 | Each application admits at most four uploads by default, with a default 30-second deadline beginning at admission and covering reception and processing. Admission is synchronous before asynchronous request work, has no queue and is independent between app instances. |
| U03 | Each admitted request retains capacity until all its work, rejection draining and disposal attempts settle. An early response, cancellation signal, normal request-body close or repeated transport event must not release another request's capacity.                     |
| U04 | Client disconnect and deadline cancel receiving and counting. A deadline can return 503 while disposal remains pending; a new request is still rejected until that work settles.                                                                                           |
| U05 | A closing multipart delimiter is not HTTP completion. An unfinished epilogue cannot trigger counting or success and remains subject to the same deadline.                                                                                                                  |
| U06 | Rejected input is discarded only within a documented finite byte allowance and the admission deadline, then its connection is closed. Error responses may be unavailable to a sender whose socket closes first; never consume an arbitrary rejected body indefinitely.     |
| U07 | Concurrent uploads use independent private directories and a fixed server-selected filename. Storage creation, receive, parser and removal errors cannot leak capacity or reveal private paths; a failed removal is not reported as successful deletion.                   |
| U08 | Stopping admission rejects new uploads and provides a waitable barrier that resolves only after outstanding work settles. Application close participates in this barrier; shutdown signal timing is specified in 004.                                                      |
| U09 | Use real HTTP tests for saturation, two independent applications, stalled headers/body, disconnect, open epilogue, deadline during processing and delayed disposal. Use deterministic work barriers where possible, plus focused admission/error unit tests.               |
| U10 | Keep retained upload memory bounded through streams and bounded parser reads. Document the separate ingress responsibility for total transport bytes, headers, connection limits and fleet/tenant quotas, and the orphan-file risk after crashes or failed removal.        |

The deadline is cooperative cancellation of asynchronous work, not a promise to
preempt a blocked JavaScript event loop or an uninterruptible filesystem call.
A process/container supervisor remains the final bound on a stuck replica.
U06's drain/deadline applies to admitted requests. Busy/draining requests never
acquire capacity: send their safe rejection and promptly close, without awaiting
body completion, creating files or queuing. The same upload error shape and retry
header apply during application close while a response is still deliverable.
U09's stalled-header cases mean multipart-part headers after complete HTTP request
headers. Partial HTTP headers precede admission and remain an ingress responsibility.
Record actual verification before merging and selecting 004.
