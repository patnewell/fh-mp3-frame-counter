# Assignment acceptance and verification

This page maps the [assignment](assignment.pdf) to the delivered service and
summarizes the checks performed. For setup and a manual sample upload, follow
the [README](../README.md).

## Acceptance map

| Requirement                             | Implementation and evidence                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                              | Source, tests, scripts and runner configuration use strict TypeScript with NodeNext/ESM checking.                                                  |
| POST `/file-upload`                     | Fastify accepts one multipart file named `file`; real HTTP and compiled-process tests exercise the endpoint.                                       |
| Correct JSON and headers                | The sample returns HTTP 200, JSON content type and exactly `{"frameCount":6090}`. Upload errors contain one `error` string.                        |
| Logical MPEG-1 Layer III frame counting | `src/mp3/` walks headers and complete frame extents, including physical Xing/Info carriers, without relying on duration or advertised totals.      |
| No MP3 parsing package                  | The counter is implemented locally. Runtime packages are Fastify, `@fastify/multipart` and `env-schema`.                                           |
| Other MPEG versions outside scope       | A valid MPEG-2 fixture is rejected; the parser supports MPEG-1 Layer III only.                                                                     |
| Useful error handling                   | Typed errors map to 400/413/415/503 responses or a generic 500. Real HTTP tests cover invalid input, disconnects, deadlines and recovery.          |
| Large-file handling                     | Direct streaming, bounded parser state, cooperative yielding and per-app admission; lazy correctness tests and an independent native memory check. |
| Maintainable code and tools             | Small parser, transport and runtime modules; descriptive ownership/format comments; Biome, strict typechecking and Vitest coverage.                |
| Independent expectations                | Six committed audio fixtures have documented hashes and counts; tests use the manifest rather than parser output to establish answers.             |
| Git and a structured approach           | The repository includes source and test history. The architecture, format rules, test strategy and deployment limits are documented.               |
| Running and testing instructions        | The README and development guide provide Linux/Unix, macOS and native Windows commands, including a sample upload.                                 |

## Scope of correctness

The service supports indexed CBR/VBR and bounded free-format inference, with
supported ID3 and APE metadata. It counts structurally identifiable frames;
compressed samples and CRCs are not decoded or validated. Metadata fields are
checked where needed to locate boundaries. Incorrect declared lengths can obscure
audio, and free-format ambiguity or excessive search work can cause rejection.
See [MP3 limits](mp3.md#deliberate-limits).

The supplied sample is **1,458,172 bytes**, with SHA-256
`97707a18a58ba75122b1668f5ed738f090121343432d9172a6409ddfa4fc5ab3`.
Its independent expectation is 6089 decoder packets plus one physical Xing
carrier: **6090 frames**. The [fixture guide](../tests/fixtures/README.md) gives
the evidence for every asset, including the free-format fixture's retained LAME
authoring evidence. A fresh LAME decode is not part of the normal test suite.

## Verification results

Executed on **2026-11-13**, using native **Windows x64**, Node **24.22.3** and
npm **11.19.1**. The working tree was based on
`5bdb1ea197427685ce0e4705fe3d33658e0661e4`, with README/documentation edits
pending. Production code, tests, fixtures and build configuration were unchanged.

`npm.cmd run verify` passed lint, strict typechecking, a clean build and coverage:
**370 passed, zero failed, three expected POSIX-signal skips**, across 20 test
files. Coverage was **97.95% statements, 96.08% branches, 97.61% functions and
99.23% lines**. The sample returned its expected count and all six fixture
identity/expectation checks passed.

After that build, `node scripts/resource-check.ts` passed against the compiled
`dist/server.js` entrypoint:

| Measurement                                   | Result                            |
| --------------------------------------------- | --------------------------------- |
| Lazy file bytes                               | 536,871,536                       |
| Independent expected and returned frame count | 1,284,528                         |
| Server baseline RSS                           | 79,888,384 bytes                  |
| Server peak RSS                               | 93,376,512 bytes (about 89.1 MiB) |
| Server memory ceiling                         | 268,435,456 bytes (256 MiB)       |
| Memory observations                           | 60                                |
| Separate client peak RSS                      | 73,842,688 bytes                  |
| Liveness after upload                         | Passed                            |

The resource report records execution at **05:31:23.476-05:31:25.406 UTC**,
the revision above and `workingTreeDirty: true`. Generated results are in
`reports/tests.json`, `coverage/` and `reports/resources-native.json`; commands
regenerate these ignored outputs. The measurements apply to this run and input.

## Deployment qualification

The [CI workflow](../.github/workflows/verify.yml) configures Linux, macOS and
Windows application jobs and a Linux container job. Its presence does not establish
a hosted run or repository branch-protection settings.

The container smoke and memory checks require Docker. The Docker executable is
unavailable in this environment, so those checks were not run for this revision.
The [development guide](development.md#run-the-linux-container) provides commands
to run those checks in an environment with a Linux Docker engine.

Native Windows skips three POSIX shutdown-signal tests. Linux/macOS process
handlers and hosted jobs were not executed in this documentation pass. Production
throughput, tail latency and fleet capacity require representative load testing;
the lazy resource check measures only its stated input and process envelope.
