# Operations

The deployment target is a Linux container. See [development](development.md) for
explicit Linux/Unix, macOS and native Windows setup, environment and Docker commands.
[Verification](verification.md) distinguishes executed checks from remaining qualification.

## Configuration

`readConfig` resolves and freezes primitive values at process startup.
Programmatic app construction uses the same validation policy and defaults to
silent logging. No module below a process entrypoint reads `process.env` directly.
A `.env` file is not loaded automatically.

| Variable             | Runtime default                             | Accepted values / meaning                                                                                               |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `HOST`               | `127.0.0.1`; image `0.0.0.0`                | Nonblank, NUL-free host/address; Node must successfully bind it                                                         |
| `PORT`               | `3000`                                      | Decimal integer 0–65,535; zero selects an ephemeral server port, while the external probe requires a fixed nonzero port |
| `MAX_FILE_BYTES`     | `104857600` (100 MiB)                       | Positive safe integer, up to 9,007,199,254,740,991; file-part bytes                                                     |
| `MAX_UPLOADS`        | `4`                                         | Positive safe integer; app-local concurrent admitted uploads                                                            |
| `REQUEST_TIMEOUT_MS` | `30000`                                     | Decimal integer 1–2,147,483,647; admission through request processing                                                   |
| `SHUTDOWN_GRACE_MS`  | `10000`                                     | Decimal integer 1–2,147,483,647; time to drain before forced connection cancellation                                    |
| `UPLOAD_TEMP_DIR`    | Node's OS temporary directory; image `/tmp` | Existing, usable absolute directory without NUL bytes; private children are created inside it                           |
| `LOG_LEVEL`          | `info`                                      | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                                                            |

Integer values use decimal digits; signs, whitespace, fractions, exponent notation
and overflow are rejected. Validation bounds are not recommended resource budgets.
Choose limits that fit measured storage, memory and concurrency. Changing the
container port also requires a matching published port and probe configuration.

## Probe behavior

| Endpoint            | Healthy response          | Failure behavior                                                                     |
| ------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `GET /health/live`  | 200, `{"status":"ok"}`    | Reflects the responding process; independent of temporary storage                    |
| `GET /health/ready` | 200, `{"status":"ready"}` | 503, `{"status":"not-ready"}` while admission is stopped or storage cannot be probed |

Startup and readiness perform a real private create/write/remove operation.
Concurrent checks share only an in-flight probe; completed results are not cached.
Readiness rechecks admission after awaiting storage. A full upload budget leaves
readiness healthy; upload requests instead receive 503 with `Retry-After: 1`.
Removing usable storage fails readiness while liveness remains available, and
restoring it allows the next readiness check to recover.

The close barrier captures and awaits an in-flight probe even after the readiness
client disconnects. A failed probe/removal is not silently converted into a
successful close. Probe files remain application-owned work until settlement.

The compiled `dist/healthcheck.js` uses Node HTTP and an absolute two-second
deadline. It consumes the response without retaining the body and exits silently:
zero only after HTTP 200 completes, one for configuration/transport/status/deadline
failure. It maps wildcard binds to loopback. A trickling response cannot extend
the deadline. Docker's command timeout is three seconds, with a ten-second
interval, five-second start period and three retries.

## Container policy and sizing

The [Dockerfile](../Dockerfile) pins the official Node 24.22.3 Bookworm Slim image
to OCI index digest
`sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`.
Separate build/dependency stages leave only `dist/`, production `node_modules/`
and `package.json` under `/app`. Files belong to root; execution uses
`node:node` (UID/GID 1000).

The smoke/documented launch policy sets a read-only root, init process, dropped
capabilities, no new privileges, one CPU, 128 PIDs, 1 GiB memory and a 512 MiB
`/tmp` tmpfs with `noexec,nosuid,mode=1777`. A different temporary directory
requires its own writable mount. Runtime restrictions are supplied by the
deployment command; a Dockerfile alone does not enforce them.

Four 100 MiB uploads can occupy **400 MiB of active file data**. The tmpfs limit
leaves room for probes and filesystem overhead, but its allocated pages also
count against container memory; see [Docker's tmpfs guidance](https://docs.docker.com/engine/storage/tmpfs/).
The 256 MiB V8 old-space limit is not a total-process-memory cap. Other heap spaces,
buffers, native allocations and runtime overhead share the same container budget.
Measure peak RSS, tmpfs use and OOM behavior under representative uploads before
selecting production limits.

## Disposal, ingress and replicas

Uploads use private `mp3-*` directories and a fixed `upload.mp3`, opened
exclusively with mode 0600. Client filenames never become paths. Unix mode bits
do not replace native Windows directory ACL policy.

Disposal remains awaited after cancellation. A failed removal produces a safe
operational failure and generic 500 when a response remains possible; capacity
is released once the attempt settles. The file may remain. Crashes and forced
exit can also leave orphans. There is no background removal retry or startup
scavenger. Use disposable bounded storage; quiesce an owning instance before
manually deleting orphan directories on persistent storage.

Each replica/worker owns its local budget and temporary files. Requests need no
shared filesystem, lock or session affinity, but the local budget is not a fleet
or tenant quota. Trusted ingress supplies TLS, authentication/authorization, total
HTTP header/body limits, receive/idle timeouts, connection limits and fleet/client
quotas. Multipart preamble/epilogue bytes are not file-part bytes; incomplete HTTP
headers precede application admission.

## Shutdown and diagnosis

The first SIGINT/SIGTERM stops admission and starts close/drain. Repeated signals
do not restart the grace period. At the default ten seconds, active connections
are closed to invoke the established cancellation path. The process can exit zero
once work and cleanup settle, including after cancellation. If work remains
unsettled for one additional second, it exits one. The shutdown timers keep the
process alive to classify that outcome; an unresolved promise alone would not.

The documented and smoke launch commands set Docker's stop timeout to 15 seconds.
Increase it when increasing
`SHUTDOWN_GRACE_MS`, allowing for the additional final bound and scheduling margin.
On native Windows, `Stop-Process`/child-process kill does not establish POSIX
signal behavior; use the documented console/Docker guidance.

Generated correlation IDs and fixed event/route/category values support diagnosis.
The emitted events are `server_started` (actual port), `request_completed`
(request ID, fixed route, status and elapsed milliseconds), `upload_failed`
(request ID and processing/cleanup category), `shutdown_started` and
`shutdown_forced` (active upload count), and `server_stopped`,
`startup_failed` or `shutdown_failed`. Startup can emit a fixed failure record
before logging is configured. Other events honor the configured log level.

Application log serialization drops uploaded bytes, filenames, headers, raw
URLs/queries, filesystem paths and arbitrary exception/message text, even at trace.
This intentionally limits individual I/O diagnostics. Correlate safe events,
resource metrics and readiness failures, then reproduce with nonprivate test data.
Review any additional log field against the same boundary.

A configured image/CI job is not execution evidence. Use the release verification
record and actual container smoke output before treating a deployment as qualified.
