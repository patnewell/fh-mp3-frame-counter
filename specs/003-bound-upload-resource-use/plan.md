# 003 · Implementation plan

Start from merged 002. Keep the parser API and current response contracts.
TypeScript, Fastify and the existing test toolchain remain sufficient; no new
runtime dependency is required.

## Owned state and files

- Add `src/upload/admission.ts`: one app-local budget with synchronous acquisition,
  idempotent permit release, `stop()` and `drained()`. No acquisition has an await
  point and no counter is shared across instances.
- Add `src/upload/lifetime.ts`: one request's AbortController, deadline and
  transport listeners. A small owned-operation count distinguishes response
  completion from settled work. Release only after finishing is requested and
  every owned operation has settled; remove listeners/timer exactly once.
- Extend `route.ts` and `error.ts`: acquire in the early request hook, connect
  handlers through a scoped WeakMap, pass cancellation to streams and counting,
  and keep disposal inside awaited finally blocks. Ignore normal incoming close
  after the HTTP body is complete; unfinished request/response closure cancels.
- Evolve `createApp` to expose `{ app, admission }`, with validated immutable
  upload settings and close hooks. Update the minimal executable and test helper.
  Environment parsing, logs, readiness and shutdown deadlines remain 004.
- Permit only narrow `count(path, signal)` and `dispose(directory)` test seams.
  Defaults remain real file parsing and recursive removal. No generic filesystem
  abstraction, service container or background cleanup registry is introduced.

## Failure behavior

The deadline sends a safe 503 when possible and signals cancellation; it does not
skip disposal or prove that a dependency has returned. Disposal failure settles
the attempt, returns a generic 500 when possible and can leave an orphan.

Discard rejected input within a 64 KiB allowance and the same request deadline;
a delivered stream chunk can cross the allowance before consumption stops.
Flush a small safe rejection and close the connection. Keep any admitted permit
until draining, handler and cleanup work actually settle. Busy/draining requests
do not queue or create temporary files and carry `Retry-After: 1`. They do not wait
for rejected-body draining: send the small response and promptly close.

Set Fastify's `return503OnClosing` to false so its built-in closing response does
not bypass the stopped-admission hook and change the JSON shape or retry header.
Application close still waits for every admitted operation to settle.

The app disables competing transport timers for uploads in favor of its explicit
lifetime; ingress still owns total header/body, receive/idle and connection limits.
A per-file limit does not include arbitrary multipart preamble or epilogue bytes.
The 30-second deadline is cooperative, not a CPU-preemption mechanism.

## Verification

Unit tests cover capacity boundaries, repeated release, independent budgets,
stop/drain, settings and known error classes. Real HTTP tests use promise barriers
around count/dispose for deterministic ownership checks. Exercise a timeout and a
disconnect while work deliberately remains unsettled, and assert that another
request remains busy. Test stalled reception, bounded rejection consumption,
fixed private paths, failed cleanup and recovery. An open HTTP epilogue must
expire without invoking the parser. Preserve all 001/002 tests.

Document storage/orphan and ingress responsibilities with the behavior. Run
focused checks, independent full-diff review and the complete gate before merge.
