# Operations

The deployment target is a Linux container. See [development](development.md)
for native Linux/Unix, macOS and Windows commands, and
[verification](verification.md) for measured results and their scope.

## Configuration

`readConfig` uses Fastify's `env-schema` library for defaults, conversion and
validation, then freezes the resolved settings. Programmatic app construction
shares the schema and defaults to silent logging. Only process entrypoints read
environment values; explicit configuration is isolated from the ambient
environment. A `.env` file is not loaded automatically.

| Variable             | Default                      | Accepted meaning                                                                   |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `HOST`               | `127.0.0.1`; image `0.0.0.0` | Nonempty host/address string; Node must bind it                                    |
| `PORT`               | `3000`                       | Integer 0–65535; zero selects an ephemeral server port, but probes require nonzero |
| `MAX_UPLOADS`        | `4`                          | Positive safe integer; local admitted upload count                                 |
| `REQUEST_TIMEOUT_MS` | `30000`                      | Integer 1–2147483647; admission through processing                                 |
| `SHUTDOWN_GRACE_MS`  | `10000`                      | Integer 1–2147483647; drain before forced connection cancellation                  |
| `LOG_LEVEL`          | `info`                       | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                     |

Normal schema coercion accepts numeric strings such as `+1`, `1e3` and ` 3000`
when their converted values are integers within range. Fractional, non-finite
and out-of-range values are rejected. Validation ranges are not recommended
production budgets. Concurrency and deadlines must fit measured workload and
memory. There is no application file-size cap or upload storage directory;
file bytes flow directly to the parser.

## Health and admission

| Endpoint            | Normal result             | During draining                                     |
| ------------------- | ------------------------- | --------------------------------------------------- |
| `GET /health/live`  | 200, `{"status":"ok"}`    | Responds while the process can serve the route      |
| `GET /health/ready` | 200, `{"status":"ready"}` | 503, `{"status":"not-ready"}` after admission stops |

Readiness reflects accepting work. Temporary saturation leaves readiness healthy;
excess uploads receive 503 with `Retry-After: 1`.

The compiled `dist/healthcheck.js` probes readiness with an absolute two-second
deadline and discards the body. It exits silently: zero only after HTTP 200
completes, one for configuration/transport/status/deadline failure. Wildcard binds
map to loopback. Trickling bytes cannot extend the deadline. Docker uses a
three-second command timeout, ten-second interval, five-second start period and
three retries.

## Container policy and memory

The [Dockerfile](../Dockerfile) uses a digest-pinned Node 24.22.3 Bookworm
Slim base. Its runtime payload is compiled JavaScript, production dependencies
and package.json. Root owns code; the process runs as `node:node`.

The documented launch and smoke test use a read-only root, init, dropped capabilities,
no new privileges, one CPU, 128 PIDs and a 1 GiB memory limit. It has **no writable
upload mount and no upload tmpfs**. Runtime restrictions come from the launch
command; a Dockerfile alone does not enforce them.

The parser skips known payloads and large declared metadata bodies. It retains
small descriptors, one borrowed current source chunk, numeric inference state,
and at most 64 KiB of unknown terminal bytes. Network/multipart buffering, Node
heap/native memory and the current producer chunk add overhead. A V8 old-space
limit is not a total-process-memory cap. Total file size does not determine retained
parser memory, but each concurrent upload adds stream and processing overhead.

Separate [resource checks](testing.md#large-input-resource-checks) lazily send more
than 512 MiB using test-only limits. The native check observes server RSS separately
from the client; the container variant enforces 256 MiB total container memory,
a read-only root and no writable upload mount. Consult actual results before
claiming measured memory behavior. Production throughput, tail latency, peak
memory under representative concurrency and ingress behavior still require load
measurement for the intended deployment.

## Cancellation, rejection and replicas

Request capacity remains held until its file stream, parser and rejection work
settle. Deadlines and disconnects abort processing and close the owned stream;
a response alone cannot release a slot. Busy/draining requests do not queue.
Rejected bodies are consumed only within a 64 KiB allowance plus one crossing
chunk and the admission deadline, then their connection closes. An actively
sending client may observe a reset before reading error JSON.

Each replica owns its local budget and stream state. Requests need no shared
filesystem, lock or session affinity; local admission is not a fleet/tenant quota.
For Kubernetes HPA integration, active uploads per instance is the preferred
per-pod custom metric, with a target below `MAX_UPLOADS` to scale before saturation.
Metric publication and HPA configuration are not supplied by this service.
Trusted ingress supplies TLS, authentication, total transport/header limits,
receive/idle timeouts, connection bounds and fleet/client quotas. Multipart
preamble/epilogue bytes are outside the MP3 parser; incomplete HTTP headers precede
application admission. Any ingress body-size policy is independent of this service.

## Shutdown and diagnosis

The first SIGINT/SIGTERM stops admission and starts close/drain; repeated signals
do not restart grace. After the default ten seconds, active connections close
to invoke cancellation. Settled work permits exit zero. Work still pending one
second later causes exit one; referenced timers keep Node alive to classify it.
Cancellation is cooperative and cannot preempt blocked JavaScript or an
uninterruptible external operation.

Docker launch/smoke stop timeout is 15 seconds. Increase it when increasing
`SHUTDOWN_GRACE_MS`, allowing the final bound and scheduling margin. A native
Windows child-process kill is not POSIX graceful-shutdown evidence.

Fastify's standard Pino logger records requests at the configured `LOG_LEVEL`.
Application events cover startup, unexpected processing failures and shutdown;
generated request IDs support correlation. Messages, objects, exception details
and child logger context are unrestricted by application policy.
