# MP3 frame counter

A TypeScript and Fastify service that counts physical MPEG-1 Layer III frames
from an uploaded file. It parses frame headers as bytes arrive, without storing
the upload or buffering the complete file in memory.

## Quick start

Install **Node 24.22.3** (pinned in [.nvmrc](.nvmrc)), then run these commands
from the repository root. The [development guide](docs/development.md) covers
installation and editor setup.

**Linux/Unix and macOS:**

```sh
npm ci --ignore-scripts
npm run verify
npm start
```

**Windows PowerShell:**

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run verify
npm.cmd start
```

`verify` runs lint, typechecking, a clean build, and tests with coverage. The
standard suite needs no database, media encoder or Docker engine. On Windows,
three POSIX shutdown-signal tests are skipped; they run on Linux and macOS.

The server listens at `http://127.0.0.1:3000` by default. Stop it with Ctrl+C.

## Upload a file

From another terminal at the repository root, upload the included sample.

**Linux/Unix and macOS:**

```sh
curl --include --form 'file=@tests/fixtures/sample.mp3' http://127.0.0.1:3000/file-upload
```

**Windows PowerShell:**

```powershell
curl.exe --include --form 'file=@tests/fixtures/sample.mp3' http://127.0.0.1:3000/file-upload
```

Expect HTTP 200 with `Content-Type: application/json` and `{"frameCount":6090}`.
Replace the sample path to count another file; let curl set the multipart boundary.

## API

`POST /file-upload` accepts `multipart/form-data` containing exactly one file
field named `file`, with no extra fields. Format detection uses file bytes;
filenames and part MIME types do not affect the count. `Content-Encoding` must
be absent or `identity`.

Supported input is MPEG-1 Layer III audio (CBR, VBR or free-format) with optional
ID3 or APE metadata. The count includes physical Xing/Info carrier frames. See
the [MP3 guide](docs/mp3.md) for format rules and search limits.

| Status | Meaning                                                                               |
| ------ | ------------------------------------------------------------------------------------- |
| 200    | Complete supported framing; JSON contains one positive integer `frameCount`           |
| 400    | Missing, wrong or empty file field; malformed multipart; unsupported or invalid audio |
| 413    | Too many files, fields or multipart parts                                             |
| 415    | Unsupported request content type or encoding                                          |
| 503    | Upload capacity full, service draining or upload deadline expired                     |
| 500    | Unexpected processing failure                                                         |

Upload errors return JSON with one `error` string. Busy and draining responses
include `Retry-After: 1`. Rejected connections close; a client still sending data
may see a reset before receiving the error.

There is no application file-size cap. Success waits for the complete file,
multipart body and HTTP body. Deadlines and disconnects cancel processing;
capacity stays occupied until the request's work and cleanup settle. See
[operations](docs/operations.md) for deployment limits and ingress responsibilities.

`GET /health/live` returns 200 with `{"status":"ok"}`. `GET /health/ready` returns
200 with `{"status":"ready"}` while admission is open, or 503 with
`{"status":"not-ready"}` during draining. Upload saturation alone does not fail readiness.

## Configuration

Set environment variables before starting the server. A `.env` file is not loaded
automatically. [src/config.ts](src/config.ts) defines defaults and validation.

| Variable             | Default     | Purpose                                                                       |
| -------------------- | ----------- | ----------------------------------------------------------------------------- |
| `HOST`               | `127.0.0.1` | Listening address; the container defaults to `0.0.0.0`                        |
| `PORT`               | `3000`      | Listening port                                                                |
| `MAX_UPLOADS`        | `4`         | Maximum concurrent uploads per app instance                                   |
| `REQUEST_TIMEOUT_MS` | `30000`     | Deadline from upload admission through processing                             |
| `SHUTDOWN_GRACE_MS`  | `10000`     | Drain time before active connections are closed                               |
| `LOG_LEVEL`          | `info`      | Logging level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |

## Development and testing

| Task                            | Linux/Unix and macOS       | Windows PowerShell             |
| ------------------------------- | -------------------------- | ------------------------------ |
| Run with automatic restart      | `npm run dev`              | `npm.cmd run dev`              |
| Unit tests                      | `npm run test:unit`        | `npm.cmd run test:unit`        |
| Build and run integration tests | `npm run test:integration` | `npm.cmd run test:integration` |
| Full verification               | `npm run verify`           | `npm.cmd run verify`           |
| Format                          | `npm run format`           | `npm.cmd run format`           |

Development mode runs TypeScript source directly; `npm start` runs the compiled
`dist/server.js`. Run verification to check types and build the application.
The [testing guide](docs/testing.md) explains fixtures, helpers and coverage.

Optional container and resource checks:

| Check                 | Linux/Unix and macOS               | Windows PowerShell                     |
| --------------------- | ---------------------------------- | -------------------------------------- |
| Container smoke test  | `npm run test:container`           | `npm.cmd run test:container`           |
| Native process memory | `npm run test:resources`           | `npm.cmd run test:resources`           |
| Container memory      | `npm run test:resources:container` | `npm.cmd run test:resources:container` |

Container checks require a running Docker engine using Linux containers. The
smoke test builds the image, checks runtime restrictions, health, sample counting
and shutdown, then removes its resources. Resource checks stream over 512 MiB and
report server memory separately from client memory; the container check enforces
a 256 MiB memory limit. See [container setup](docs/development.md#run-the-linux-container)
and [resource test details](docs/testing.md#large-input-resource-checks).

## Code map

| Location                       | Responsibility                                                    |
| ------------------------------ | ----------------------------------------------------------------- |
| [src/server.ts](src/server.ts) | Process startup and shutdown                                      |
| [src/app.ts](src/app.ts)       | Fastify app construction and health endpoints                     |
| [src/upload/](src/upload/)     | Multipart validation, capacity, cancellation and error responses  |
| [src/mp3/](src/mp3/)           | Transport-independent streaming frame counter                     |
| [tests/](tests/)               | Unit tests, real HTTP/process tests and audio fixtures            |
| [scripts/](scripts/)           | Build cleanup, fixture verification and container/resource checks |

For more detail, read the [architecture](docs/architecture.md),
[MP3 format guide](docs/mp3.md), [fixture guide](tests/fixtures/README.md) and
[operations guide](docs/operations.md).
