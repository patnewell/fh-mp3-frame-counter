# 001 · Implementation plan

Read the constitution and C01–C09 before implementation. The application uses
Fastify5.12.8/multipart10.1.8, TypeScript7.0.2, Node24.22.3, Vitest5.1.0 and Biome2.6.6.
Node24.22.3 now has a published official slim image; keep later container and
native runtime pins aligned. The project lockfile fixes exact package versions.

## Decisions

- **Temporary staging:** stream the file into an exclusively created fixed-name
  file in a private temporary directory, then count using a64KiB positional cache.
  This provides a completed-file boundary for EOF checks and later compatibility
  work. It adds storage I/O and disposal; it is a revisitable implementation
  decision, not a constitutional rule. Inline counting remains a future option.
- **Domain boundary:** `countFrames(path: string, signal?: AbortSignal)` owns its
  descriptor and returns a count. `InvalidMp3Error` means invalid/unsupported media;
  cancellation and I/O errors propagate separately. MPEG code imports no HTTP policy.
- **HTTP boundary:** `createApp(options)` creates but does not listen. Options own
  the temp parent and maximum file size. A scoped upload route validates content
  type and multipart parts, receives to disk, awaits HTTP completion, counts and
  disposes in `finally`. A minimal `server.ts` starts the compiled application.
- **Errors:** centralize expected upload/media mapping and keep arbitrary exception
  text and paths out of client responses. Default logging is off until structured
  privacy-safe logging is introduced in the operational cycle.
- **Verification:** prefer actual HTTP for multipart semantics. The multipart
  dependency has an unresolved injection-only reproduction for a truncated
  over-limit second part; do not use an unsafe in-process diagnostic or claim it
  proves a production crash. Preserve limits and record follow-up evidence.

## Files and ownership

| Files | Responsibility |
| --- | --- |
| `src/mp3/{header,reader,tags,count,error}.ts` | Header interpretation, bounded reads, initial metadata, strict traversal and domain error |
| `src/upload/{route,error}.ts`, `src/app.ts` | Multipart validation, private staging, disposal and HTTP mapping |
| `src/server.ts` | Minimal executable startup; operational configuration comes in004 |
| `tests/unit/mp3/`, `tests/integration/` | Pure structural vectors, real fixture and listening HTTP regressions |
| `tests/fixtures/`, `scripts/verify-fixtures.ts` | Immutable asset identities and independent count evidence |

## Implementation and review

Establish fixture evidence first. Parser and HTTP modules can be implemented
independently against the agreed boundary within task T02; run integrated checks
only once both exist. Add tests beside their changes. Review the entire feature,
including malformed inputs and cleanup, before the complete verification gate.
Do not implement002 compatibility or003 operational ownership ahead of their specs.
