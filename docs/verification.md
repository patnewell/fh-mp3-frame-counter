# Assignment acceptance and verification

The [original assignment](assignment.pdf) requires TypeScript, a POST upload
endpoint, logical MPEG-1 Layer III frame counting without an MP3 parser package,
useful errors, scalability, clear running instructions and evidence of structured
Git use. [001](../specs/001-count-uploaded-mp3/verification.md),
[002](../specs/002-complete-mp3-compatibility/verification.md),
[003](../specs/003-bound-upload-resource-use/verification.md) and
[004](../specs/004-operate-containerized-service/verification.md) preserve
revision-specific evidence. Read those records as historical milestones.

## Acceptance map

| Requirement                                        | Implementation and evidence                                                                                                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/file-upload`, exact JSON and headers        | Scoped Fastify upload route; real HTTP and compiled-process original-sample cases assert 200, JSON content type and exactly `{"frameCount":6090}`                                                                     |
| Use TypeScript effectively                         | All executable source, tests, scripts and runner config use strict TypeScript; NodeNext/ESM, discriminated headers, explicit ownership and immutable configuration                                                    |
| Parse frames logically; no media parser dependency | `src/mp3/` traverses headers and frame extents itself; only Fastify and multipart are runtime dependencies; independent fixture evidence establishes expected counts                                                  |
| MPEG-1 Layer III correctness                       | CBR/VBR/free-format, padding, mono/stereo, CRC-bearing framing, supported ID3/APE envelopes and physical Xing/Info carriers; unit/component vectors plus six real MP3 assets                                          |
| Other MPEG versions outside scope                  | Valid MPEG-2 fixture receives a useful rejection; no decoder/transcoder or out-of-scope version implementation                                                                                                        |
| Graceful and useful errors                         | Typed invalid-media failures; 400/413/415/503 contract and generic unexpected 500; rejected/aborted transport, partial multipart and recovery tested through real sockets                                             |
| Large files and scalability                        | One 64 KiB parser cache, bounded streaming reception, file-owned ambiguity budgets, per-app admission/deadlines and awaited disposal; 71,901,184-byte / 172,032-frame traversal; no claimed production load benchmark |
| Standardized maintainable code                     | Biome, strict compiler, small domain/transport/runtime modules, ownership/format comments and architecture/MP3 guides                                                                                                 |
| Automated unit and integration tests               | Vitest pure/component tests, listening HTTP/socket cases, compiled process tests and separate actual-container smoke script; one portable `verify` command                                                            |
| Supplied sample and real fixtures                  | Unchanged 1,458,172-byte sample, SHA-256 `97707a18a58ba75122b1668f5ed738f090121343432d9172a6409ddfa4fc5ab3`; manifest/hash tests and independently established expectations                                           |
| Effective Git and structured approach              | Initial bootstrap followed by four sequential feature branches: spec, plan and tasks before implementation, cohesive commits, verified merges and preserved review findings                                           |
| Demonstrated Spec Kit Lean                         | Five unchanged official Lean skills with pinned provenance/hash checks; a constitution, explicit feature pointer and separate artifacts for each capability, not one retroactive umbrella spec                        |
| Local Codex / editor workflow                      | Concise AGENTS.md and SKILLS.md, focused review skill, VS Code tasks, advisory project configuration and explicit Linux/Unix/macOS/Windows commands                                                                   |
| Container/distributed operation                    | Non-root digest-pinned image; documented/smoke read-only and resource policy, safe logs, probes, bounded shutdown, no shared-file/lock affinity; deployment execution qualifications below                            |
| Clear setup and manual confirmation                | README install/gate/start/sample commands; development guide covers environments, VS Code/Codex, platform differences and Docker                                                                                      |
| Candidate ownership                                | Team guide asks for independent explanation, unfamiliar-case prediction and review; measured adoption, improved delivery and human approval are not inferred from generated artifacts                                 |

The source count is structural. It does not validate compressed samples, CRC
values or all metadata items. See [MP3 limits](mp3.md#deliberate-limits) and
[operations](operations.md) for ingress, failed disposal and resource boundaries.

## Evidence scope

All recorded local application gates use Linux x64 and Node 24.22.3. Historical
counts remain 125 tests for 001, 187 for 002 and 227 for 003; the final operational
cycle records its own larger suite. Coverage percentages measure only the stated
source set; `server.ts` and `healthcheck.ts` are exercised as compiled child
processes outside that coverage set.

The original and indexed additional fixtures were independently checked using
FFprobe/FFmpeg 7.1.5. The free-format fixture's identity and 1,200-byte spacing were
freshly checked; its retained LAME 3.100 authoring/decode evidence was not rerun
because that tool was unavailable. Its 22-frame oracle is not derived from the
application parser. See [fixture provenance](../tests/fixtures/README.md).

## Remaining qualification

- The actual Docker smoke was attempted and stopped at preflight because the
  Docker executable was absent (`spawn docker ENOENT`). No image build, runtime
  restriction, container upload, disposal or stop check is claimed as executed.
- Native macOS, native Windows and hosted CI were not run here. Their jobs and
  explicit commands are supplied. POSIX-only signal/filesystem test mechanisms
  do not claim equivalent native Windows coverage.
- The known multipart dependency skip-path qualification and the fresh real-wire
  regressions are described in [testing](testing.md#known-dependency-qualification).
  Passing those transport cases does not establish all dependency event orderings.
- Peak RSS/tmpfs/CPU, throughput, overload under representative production traffic
  and ingress integration still need measurement. Configured quotas are not a
  benchmark or a fleet-wide limit.
- Hosted required checks, independent human approvals and permissions need
  maintainer configuration. Team adoption and net delivery improvement need a
  real pilot; the repository does not fabricate those outcomes.

The final source gate is recorded in the operational feature. The release archive
is subsequently checked for complete Git history, fixture/skill identities and a
clean checkout, then installed and verified from its actual extraction. The
delivery report identifies that archive and its extraction result without
rewriting earlier milestone evidence.
