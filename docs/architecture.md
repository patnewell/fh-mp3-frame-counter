# Architecture

## Domain boundary

The domain operation counts physical MPEG-1 Layer III frames in completed,
unchanging bytes. It currently accepts a file path through `countFrames(path,
signal?)`. The parser owns and closes its descriptor, returns a positive count,
and uses `InvalidMp3Error` only for invalid/unsupported media. I/O errors and
cancellation remain distinguishable. HTTP status and admission do not enter it.

Fastify owns HTTP transport. A scoped upload adapter validates multipart input,
receives a private file, calls the parser and disposes the data. App construction
and process startup remain separate. Mutable state belongs to an instance or
request; there is no account, patient, database or persistent-media model.

| File                  | Responsibility                                                               |
| --------------------- | ---------------------------------------------------------------------------- |
| `src/app.ts`          | Construct one Fastify instance and register the upload scope                 |
| `src/server.ts`       | Start the compiled executable                                                |
| `src/upload/route.ts` | Validate transport headers, stream/complete the request, stage/count/dispose |
| `src/upload/error.ts` | Map known failures and hide unexpected exception details                     |
| `src/mp3/header.ts`   | Pure MPEG header interpretation and indexed frame lengths                    |
| `src/mp3/reader.ts`   | Bounded positional file reads and cancellation checks                        |
| `src/mp3/tags.ts`     | Initial ID3 envelope validation at established boundaries                    |
| `src/mp3/count.ts`    | Descriptor ownership and physical frame traversal                            |
| `src/mp3/error.ts`    | Domain-specific invalid-media error                                          |

Read app, upload route, then count to follow a successful request. There is no DI
container, controller/service/repository layer stack, barrel hierarchy or generic
utilities directory. Biome enforces parser independence; a test exercises the real
rule with both permitted and forbidden code.

## Temporary staging decision

The upload is streamed to a private directory using an exclusive fixed filename;
the client filename is never a path. Parsing uses one 64 KiB cache. This yields a
completed-file view and makes EOF checks and later seek-dependent compatibility
work straightforward. It costs a write/read pass and explicit disposal.

For ordinary indexed frames, inline counting could overlap upload with parsing
and avoid whole-file staging. That alternative would need explicit chunk-boundary,
EOF, metadata, cancellation and compatibility rules. Staging is the selected
implementation for this release, not a general requirement of MP3 counting or a
constitutional principle. A substantial change to this boundary deserves a new
specification with behavior and resource evidence.

Request-local temporary files do not create session affinity or durable application
state. Replicas are independent; local data cannot be relied on after process loss.
Storage retention, transcription, transcoding, identity and durable jobs would
introduce different ownership and belong to separately specified capabilities.

## Tool choices

Fastify supplies maintained HTTP/multipart lifecycle handling without imposing
extra application layers. TypeScript 7.0.2 is pinned with strict NodeNext settings;
Node 24.22.3 is a maintained LTS patch whose official slim image is available. The
compiler checks code that native development type stripping does not check.
Production executes compiled JavaScript. Vitest covers unit and real integration
tests; Biome provides one formatter/linter and the dependency boundary.

The harness uses concise module/command guidance inspired by
[Playwright](https://github.com/microsoft/playwright/blob/main/AGENTS.md), the
[Clean Code TypeScript](https://github.com/labs42io/clean-code-typescript) principles
of descriptive names and cohesive responsibilities, and Thoughtworks' warning
about [agent instruction bloat](https://www.thoughtworks.com/en-us/radar/techniques/agent-instruction-bloat).
Load focused context and prefer a regression or deterministic check over another
permanent instruction. The Lean workflow is recorded in [the delivery map](../specs/README.md).
