# MP3 frame counter

Upload an MPEG-1 Layer III file to `POST /file-upload` and receive its physical
frame count. The supplied sample returns exactly `{"frameCount":6090}`.

The service uses TypeScript and Fastify. It reads MPEG headers itself; no media
parsing dependency supplies the count. The [original assignment](docs/assignment.pdf)
is included. Five [sequential Spec Kit Lean cycles](specs/README.md) show the
contract, plan, tasks, implementation, review and verification of each capability.

## Run and verify

Install **Node 24.22.3** and Git. The [development guide](docs/development.md) gives
explicit installers, editor setup and command equivalents for every platform.
From the extracted repository directory, run the applicable block and stop if a
command fails.

**Linux/Unix or macOS**:

```sh
npm ci --ignore-scripts
npm run verify
node dist/server.js
```

**Native Windows PowerShell**:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run verify
node dist/server.js
```

`verify` lints, typechecks, builds and runs unit/integration tests with coverage.
Normal tests need no database, media encoder or Docker daemon. The server listens
on `http://127.0.0.1:3000`.

On native Windows, expect **three skipped tests** that require POSIX shutdown
signals. They run on Linux/macOS; Windows process termination does not exercise those
mechanisms. All other tests must pass. See [test details](docs/testing.md#process-platform-and-container-checks).

From another terminal at the repository root:

| Platform           | Upload command                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Linux/Unix         | `curl --include --form 'file=@tests/fixtures/sample.mp3' http://127.0.0.1:3000/file-upload`     |
| macOS              | `curl --include --form 'file=@tests/fixtures/sample.mp3' http://127.0.0.1:3000/file-upload`     |
| Windows PowerShell | `curl.exe --include --form 'file=@tests/fixtures/sample.mp3' http://127.0.0.1:3000/file-upload` |

Expect HTTP 200 and `{"frameCount":6090}` with an `application/json` content type.
Let curl generate the multipart boundary. Stop the server with Ctrl+C.
`GET /health/live` and `GET /health/ready` expose process liveness and whether
the application is accepting work. Upload saturation alone does not fail readiness.

## HTTP contract

Send one multipart file named `file` and no extra fields. File bytes determine
format; filenames and part MIME claims are ignored. Content encoding must be
absent or `identity`. Success contains only a positive integer `frameCount`.

| Status | Meaning                                                                      |
| ------ | ---------------------------------------------------------------------------- |
| 200    | Complete supported framing counted                                           |
| 400    | Missing/wrong/empty file, malformed multipart, unsupported or invalid MPEG   |
| 413    | File-byte, file-count, field-count or part-count limit                       |
| 415    | Unsupported request content type or encoding                                 |
| 503    | Upload capacity full, admission stopped or admitted request deadline expired |
| 500    | Safe generic unexpected processing failure                                   |

Upload error JSON has one `error` string. A sender still uploading rejected data can
observe a connection close before reading the error. The default file limit is
100 MiB, with four concurrent uploads per app and a 30-second admission-to-processing
deadline. Busy/draining responses include `Retry-After: 1`. The parser consumes
file bytes as they arrive, with no upload file, tmpfs or complete in-memory
buffer. Success waits for valid file EOF, multipart completion and the complete
HTTP body. Cancellation does not release capacity while stream/parser/rejection
work remains unsettled.

The existing startup remains `src/server.ts` → `src/app.ts` →
`src/upload/route.ts`. The upload route calls the counter with the incoming
multipart file stream directly. The resource check runs this same compiled
server; it has no separate application bootstrap.

Ordinary CBR/VBR uses each frame's header. Free-format commits the first
compatible boundary within 128 KiB, with fixed search/run limits. Declared
metadata bodies are skipped incrementally; an unknown footer-only suffix is
limited to 64 KiB. The [MP3 guide](docs/mp3.md) explains these streaming
compatibility rules and their deliberate differences from the historical seek parser.

## Container evaluation

Install a running Linux Docker engine; Docker Desktop must use Linux containers
on macOS/Windows. The smoke command builds an isolated image/container, checks
runtime restrictions, health, the original sample and clean stop, then
removes its resources.

| Platform           | Container smoke              |
| ------------------ | ---------------------------- |
| Linux/Unix         | `npm run test:container`     |
| macOS              | `npm run test:container`     |
| Windows PowerShell | `npm.cmd run test:container` |

The container uses a read-only root with no writable upload mount. Separate heavy
resource checks lazily send over 512 MiB with test-only upload/deadline overrides:

| Platform           | Isolated process             | Constrained Linux container            |
| ------------------ | ---------------------------- | -------------------------------------- |
| Linux/Unix         | `npm run test:resources`     | `npm run test:resources:container`     |
| macOS              | `npm run test:resources`     | `npm run test:resources:container`     |
| Windows PowerShell | `npm.cmd run test:resources` | `npm.cmd run test:resources:container` |

These checks report server memory separately from client memory. The container
variant uses a 256 MiB budget and no upload storage. See the
[005 verification record](specs/005-incremental-mp3-parsing/verification.md) for
actual measurements and any unexecuted checks; supplied scripts alone are not measurements.

See [development](docs/development.md#run-the-linux-container) for manual launch
commands and [operations](docs/operations.md) for resource sizing and ingress
responsibilities. [Verification](docs/verification.md) separates actual results
from configured Docker/native/hosted checks that remain unexecuted.

## Read the implementation

- [Architecture](docs/architecture.md): domain boundary, stream ownership and incremental counting.
- [MP3 format](docs/mp3.md): headers, frame lengths, tags and physical carrier counts.
- [Development](docs/development.md): native platform, VS Code, Codex and Git workflow.
- [Fixture evidence](tests/fixtures/README.md): unchanged assets and independent expectations.
- [Testing](docs/testing.md): real boundaries, deterministic lifecycle checks and coverage.
- [Operations](docs/operations.md): configuration, probes, logs, shutdown and container sizing.
- [Verification](docs/verification.md): assignment acceptance map and actual evidence.
- [Feature history](specs/README.md): completed Lean cycles and their Git sequence.
- [AGENTS.md](AGENTS.md) / [SKILLS.md](SKILLS.md): focused guidance and official Lean skills.
