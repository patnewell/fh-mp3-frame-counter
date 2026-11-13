# Testing

Use the pinned Node version and [platform commands](development.md). `verify`
lints, typechecks, builds cleanly and runs Vitest with V8 coverage. Unit-only
runs execute TypeScript source; integration/all-test scripts build first.
Ordinary tests need no media tools, database or Docker daemon.

## Test coverage

| Location                                     | Purpose                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/mp3/`                            | Pure headers, arbitrary chunks, complete-frame counting, metadata, local free-format inference, resource bounds, cancellation and iterator ownership |
| `tests/unit/upload/`                         | Admission isolation/idempotence/drain and safe error/rejection classification                                                                        |
| `tests/unit/config.test.ts`                  | Immutable settings, environment isolation and configuration validation                                                                               |
| `tests/unit/harness.test.ts`                 | Biome import restrictions, vendored-file integrity and measurement-preload exit                                                                      |
| `tests/integration/fixtures.test.ts`         | Fixture identities and independent counts and a lazy 71,901,184-byte real-audio traversal                                                            |
| `tests/integration/upload.test.ts`           | Listening HTTP, all fixtures, envelopes, invalid inputs, limits and recovery                                                                         |
| `tests/integration/multipart.test.ts`        | MIME/boundary normalization, malformed parts, encoding and HTTP-body completion                                                                      |
| `tests/integration/upload-lifecycle.test.ts` | Explicit parser/stream barriers for overload, cancellation, deadlines, provisional work and settled ownership                                        |
| `tests/integration/closing.test.ts`          | Active keep-alive connection after close begins retains exact draining response                                                                      |
| `tests/integration/operations.test.ts`       | Liveness, accepting/draining readiness and saturation policy                                                                                         |
| `tests/integration/process.test.ts`          | Compiled startup, sample, probes, malformed transport and bounded shutdown                                                                           |
| `scripts/container-smoke.ts`                 | Actual image/runtime restrictions, sample, probes and clean stop without writable upload storage                                                     |

Real sockets exercise multipart parsing, streams and connection closure. An
injected response alone does not establish that transport behavior.

## Test helpers and conventions

| Helper                              | Responsibility                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tests/helpers/http.ts`             | Fixture paths, FormData, raw multipart requests and isolated listening apps. Raw responses use Node's stream consumer. |
| `tests/helpers/upload-lifecycle.ts` | App and socket ownership for unfinished uploads and controlled parser operations.                                      |
| `tests/helpers/process.ts`          | Compiled children, isolated working directories, bounded output and captured JSON events.                              |
| `tests/helpers/parser-server.ts`    | Child-process fixture using the existing counter seam to observe entry, hold work or fail after cancellation.          |
| `tests/helpers/mp3.ts`              | Structural byte vectors and lazy chunk boundaries; real-audio expectations come from the fixture manifest.             |
| `tests/helpers/async.ts`            | A deadline for a single promise observation, preserving the original rejection.                                        |

Use `it.each` to run the same check with different inputs, and include the changing
value in the title so failures identify the input. Use [Vitest polling assertions](https://vitest.dev/api/expect.html#poll)
for changing state, `vi.waitUntil` when a captured value is needed, and Vitest mocks
for call counts or one-off failures. Restore environment stubs in `afterEach`.
Native `Promise.withResolvers` provides explicit barriers without a custom wrapper.

`within` remains a small shared helper because an observation must reject on the
first failure, without retries. Its timeout does not cancel the underlying work.
The owning `finally` block must release barriers, destroy requests and await
cleanup. Keep these scopes local: some cases need two independent apps, or must
observe a process or app after a response completes.

Use real timers for real sockets and child processes. Wait for parser barriers
and captured events instead of sleeping to guess progress. Check elapsed time
only when the deadline itself is the requirement, allowing scheduling margin.
The epilogue cases check both successful completion after HTTP EOF and deadline
rejection while EOF is withheld. Process event waits use complete JSON lines and
wait for stdio closure before classifying an event as missing.

Prefer domain error types to internal wording. A specific reason assertion is
useful when a malformed input could otherwise pass the test through a different
rejection path, such as exhausting the metadata alternative-chain budget.

## Independent inputs and parser progress

The supplied sample yields **6090 physical frames**. The [fixture guide](../tests/fixtures/README.md)
and [manifest](../tests/fixtures/manifest.json) document all six assets, their
hashes and independently established counts. Tests never derive expected counts
from the application parser. Synthetic vectors isolate malformed headers,
truncation and payload lookalikes; they are separate from real encoded audio.

Parser tests cover header and metadata splits, one-byte and varied chunks,
multiple frames per chunk, incomplete payloads, VBR/padding changes, free-format
boundary choices, search limits, cancellation and iterator release. Metadata
cases distinguish usable extent information from unrelated tag fields, and
retain failures for truncated extents or audio resuming after terminal metadata.

A controlled source supplies an invalid ID3 descriptor while withholding EOF.
Rejection before another pull proves validation begins during reception.
Event-loop cases cover both large producer chunks and many small chunks.

Two lazy large-input cases exercise traversal without collecting a complete body:

| Boundary                                                | File bytes  | Independent expected count |
| ------------------------------------------------------- | ----------- | -------------------------- |
| Domain stream: 8192 repetitions of the 21-frame fixture | 71,901,184  | 172,032                    |
| Real HTTP: 12,000 repetitions of the same fixture       | 105,324,000 | 252,000                    |

The HTTP case uses the default file-size policy and catches an unintended
multipart file-size cap. These are correctness tests; memory measurements use
the separate resource checks below.

## Deterministic lifecycle tests

Barriers hold parser work after an abort or response. Capacity, application drain
and close remain occupied until that work settles. Test owners release barriers
and close sockets in `finally`; an observation timeout does not cancel the work.

An unfinished HTTP epilogue permits provisional counting but prevents success
and remains subject to the admission deadline. Additional or malformed parts
must reject even after a valid first-file count. Other cases cover stalled part
headers, disconnects, deadlines, overload, independent apps, failed counters and
recovery on a later request.

## Coverage and review

Coverage thresholds over `src/` are **90% statements, 85% branches, 90% functions
and 90% lines**. Executable `server.ts` and `healthcheck.ts` are excluded from
this coverage set and exercised by compiled child-process tests.

Vitest writes generated `reports/tests.json` and `coverage/` outputs. They are
ignored by Git and regenerated on each run. The [verification summary](verification.md)
records results and environment limitations. Review changed assertions, fixture
oracles and ownership paths as well as production code; coverage alone does not
establish that a requirement has a meaningful test.

## Process, platform and container checks

Compiled process tests launch from a temporary directory containing spaces.
They check startup, sample counting, probes, malformed multipart,
late parser failures and bounded shutdown. The process fixture can observe parser
entry, fail after cancellation or hold work indefinitely.

Exactly **three tests skip native Windows**, where child-process termination
does not deliver POSIX signals to JavaScript handlers:

- SIGTERM allows an admitted upload to complete during grace.
- SIGINT grace expiry cancels an unfinished upload and awaits settled work.
- Repeated signals do not reset the final bound for uncooperative parser work.

These cases run on Linux and macOS. Docker's Linux process supplies a separate
signal boundary on any supported host.

The container smoke script builds an image, creates uniquely named resources
and removes them in `finally`. It checks read-only storage, the non-root user,
code ownership, health, security/resource restrictions, the sample's 6090 frames
and a clean stop. Docker must be available for those assertions to execute.

## Large-input resource checks

These checks are separate from the standard verification command:

| Mode                        | Linux/Unix and macOS               | Windows PowerShell                     |
| --------------------------- | ---------------------------------- | -------------------------------------- |
| Isolated native process     | `npm run test:resources`           | `npm.cmd run test:resources`           |
| Constrained Linux container | `npm run test:resources:container` | `npm.cmd run test:resources:container` |

Both modes lazily repeat the 8777-byte, 21-frame fixture 61,168 times:
**536,871,536 file bytes** and **1,284,528 expected frames**. The client retains
one fixture block and respects backpressure. Concurrency and request deadlines
use test settings.

The native command builds and launches `dist/server.js` with a measurement-only
preload. It samples server RSS and the OS high-water RSS, checks a 256 MiB server
ceiling, and reports client memory separately. The preload opens no listener and
keeps no timer or IPC handle referenced. JavaScript heap usage alone is not the
memory measurement.

The container command builds its own image. It enforces 256 MiB total memory with
swap disabled, a read-only root and no writable upload mount. It samples available
container memory, checks the count and confirms that the service remains healthy.
Both modes set a 128 MiB V8 old-space limit.

Results go to `reports/resources-native.json` or
`reports/resources-container.json`, including revision, working-tree state,
runtime, timestamps and any unavailable environment. See [verification](verification.md)
for recorded results. These tests establish their input and memory envelope;
production throughput and capacity require representative load measurements.

<a id="known-dependency-qualification"></a>

## Dependency upgrade checks

Multipart parsing depends on stream event ordering. The compiled-process cases
send malformed second parts over both Content-Length and chunked HTTP, and check
safe responses and continued readiness. Retain these real-wire
regressions when upgrading Fastify or multipart dependencies, and reproduce any
new failure in isolation. Passing the suite covers its cases, rather than every
possible dependency event ordering.
