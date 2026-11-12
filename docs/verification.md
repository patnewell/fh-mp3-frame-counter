# Assignment acceptance and verification

The [original assignment](assignment.pdf) requires TypeScript, a POST upload
endpoint, logical MPEG-1 Layer III frame counting without an MP3 parser package,
useful errors, scalability, clear running instructions and evidence of structured
Git use. [001](../specs/001-count-uploaded-mp3/verification.md),
[002](../specs/002-complete-mp3-compatibility/verification.md),
[003](../specs/003-bound-upload-resource-use/verification.md) and
[004](../specs/004-operate-containerized-service/verification.md) preserve
revision-specific evidence. Read those records as historical milestones.

Feature [005](../specs/005-incremental-mp3-parsing/spec.md) selects the current
incremental architecture. Its [verification record](../specs/005-incremental-mp3-parsing/verification.md)
contains the tested revision, complete gate/resource results, compatibility
supersessions, replaced storage/seek cases and remaining qualifications. Use that
record for current execution claims; the milestone sections below preserve the
original literal dates, counts and tested hashes.

## Acceptance map

| Requirement                                        | Implementation and evidence                                                                                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/file-upload`, exact JSON and headers        | Scoped Fastify upload route; real HTTP and compiled-process original-sample cases assert 200, JSON content type and exactly `{"frameCount":6090}`                                                                                                        |
| Use TypeScript effectively                         | All executable source, tests, scripts and runner config use strict TypeScript; NodeNext/ESM, discriminated headers, explicit ownership and immutable configuration                                                                                       |
| Parse frames logically; no media parser dependency | `src/mp3/` traverses headers and frame extents itself; only Fastify and multipart are runtime dependencies; independent fixture evidence establishes expected counts                                                                                     |
| MPEG-1 Layer III correctness                       | CBR/VBR/free-format, padding, mono/stereo, CRC-bearing framing, supported ID3/APE envelopes and physical Xing/Info carriers; unit/component vectors plus six real MP3 assets                                                                             |
| Other MPEG versions outside scope                  | Valid MPEG-2 fixture receives a useful rejection; no decoder/transcoder or out-of-scope version implementation                                                                                                                                           |
| Graceful and useful errors                         | Typed invalid-media failures; 400/413/415/503 contract and generic unexpected 500; rejected/aborted transport, partial multipart and recovery tested through real sockets                                                                                |
| Large files and scalability                        | Direct incremental file-stream counting, fixed parser state/search/suffix bounds and settled stream/parser admission; lazy 71,901,184-byte / 172,032-frame traversal and separate >512 MiB process/container resource checks; actual measurements in 005 |
| Standardized maintainable code                     | Biome, strict compiler, small domain/transport/runtime modules, ownership/format comments and architecture/MP3 guides                                                                                                                                    |
| Automated unit and integration tests               | Vitest pure/component tests, listening HTTP/socket cases, compiled process tests and separate actual-container smoke script; one portable `verify` command                                                                                               |
| Supplied sample and real fixtures                  | Unchanged 1,458,172-byte sample, SHA-256 `97707a18a58ba75122b1668f5ed738f090121343432d9172a6409ddfa4fc5ab3`; manifest/hash tests and independently established expectations                                                                              |
| Effective Git and structured approach              | Bootstrap and sequential Lean cycles: spec, plan and tasks committed before implementation, cohesive source/test commits and preserved review evidence; 005 explicitly supersedes seek/storage choices                                                   |
| Demonstrated Spec Kit Lean                         | Five unchanged official Lean skills with pinned provenance/hash checks; a constitution, explicit feature pointer and separate artifacts for each capability, not one retroactive umbrella spec                                                           |
| Local Codex / editor workflow                      | Concise AGENTS.md and SKILLS.md, focused review skill, VS Code tasks, advisory project configuration and explicit Linux/Unix/macOS/Windows commands                                                                                                      |
| Container/distributed operation                    | Non-root digest-pinned image, read-only root with no writable upload mount, explicit resource/security policy, safe logs, readiness, bounded shutdown and no shared-file/session affinity; execution qualifications in 005                               |
| Clear setup and manual confirmation                | README install/gate/start/sample commands; development guide covers environments, VS Code/Codex, platform differences and Docker                                                                                                                         |
| Candidate ownership                                | Team guide asks for independent explanation, unfamiliar-case prediction and review; measured adoption, improved delivery and human approval are not inferred from generated artifacts                                                                    |

The source count is structural. It does not validate compressed samples, CRC
values or all metadata items. See [MP3 limits](mp3.md#deliberate-limits) and
[operations](operations.md) for ingress and resource boundaries. Parsing begins
before EOF; success still requires complete valid file, multipart and HTTP input.

## Current incremental acceptance

| 005 requirement | Current implementation and check                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01–S04         | Async byte-source domain API, per-header CBR/VBR traversal, unchanged fixture oracles and provisional work before EOF with complete-success transport validation                 |
| S05–S09         | 128 KiB free-frame distance, 4096 inference runs, 16 MiB inference positions, at most 64 KiB unknown terminal suffix, bounded alternatives and cooperative yielding/cancellation |
| S10–S11         | Direct multipart file stream, limits, truncation, safe errors and admission held until parser/stream/rejection settlement; actual HTTP/process regressions                       |
| S12             | No upload storage/configuration/probes/disposal; readiness follows accepting work while saturation alone stays healthy                                                           |
| S13–S14         | Read-only mount-free deployment, independent lazy large-input checks with server memory observations, unchanged gates/fixtures and local Lean commit sequence                    |

The [compatibility matrix](../specs/005-incremental-mp3-parsing/spec.md#compatibility-matrix)
documents local free-format commitment and bounded footer-only metadata instead
of silently claiming the old seek-dependent behavior. The heavy checks write
`reports/resources-native.json` and `reports/resources-container.json`; these
generated artifacts and the active verification record distinguish observations
from configured limits. No production throughput or fleet-capacity claim follows
from them.

## Historical 004 application gate

The clean revision `a67beed776cbeb663f44640f27f5081a4a46555d` passed
`npm run verify`: lint, strict typecheck, clean compilation and **318 tests
across 19 files** (225 unit/component, 93 integration, no failures or skips).
Coverage is 96.99% statements, 95.59% branches, 97.64% functions and 99.35% lines.
The [004 record](../specs/004-operate-containerized-service/verification.md)
explains review corrections, red/green regressions and the precise coverage scope.
Subsequent evidence/merge commits do not change application behavior.

## Historical 004 native Windows follow-up

On 2026-11-12, native Windows x64 with Node 24.22.3 / npm 11.19.1 reproduced
one failure and four skips at base `b8e43ab8bf99b9aeffcc23308a371ff65f3273b7`.
The oversized-rejection test required a delivered HTTP response even though U06
allows a reset before delivery. The working-tree correction accepts only the exact
415 JSON or `ECONNRESET`, retaining closure/ownership checks and adding no-parser,
no-retained-data and recovery assertions; application behavior is unchanged.

`npm.cmd ci --ignore-scripts` succeeded, and the corrected `npm.cmd run verify`
passed lint, typecheck, build and coverage: **314 passed, zero failed, four
skipped**, with the same coverage percentages and thresholds as the Linux gate
above. The skips are the three POSIX shutdown signal tests and one POSIX FIFO/
SIGUSR2 readiness ownership test. See the [004 follow-up record](../specs/004-operate-containerized-service/verification.md#native-windows-follow-up-2026-11-12)
for review, regression evidence and limits. Linux/macOS, Docker and hosted CI were
not rerun for this correction.

## Historical milestone evidence scope

The original milestone application gates use Linux x64 and Node 24.22.3. Historical
counts remain 125 tests for 001, 187 for 002 and 227 for 003; the final operational
cycle has 318. Coverage percentages measure only the stated
source set; `server.ts` and `healthcheck.ts` are exercised as compiled child
processes outside that coverage set.

The original and indexed additional fixtures were independently checked using
FFprobe/FFmpeg 7.1.5. The free-format fixture's identity and 1,200-byte spacing were
freshly checked; its retained LAME 3.100 authoring/decode evidence was not rerun
because that tool was unavailable. Its 22-frame oracle is not derived from the
application parser. See [fixture provenance](../tests/fixtures/README.md).

## Historical milestone qualification

- The actual Docker smoke was attempted and stopped at preflight because the
  Docker executable was absent (`spawn docker ENOENT`). No image build, runtime
  restriction, container upload, disposal or stop check is claimed as executed.
- Native macOS and hosted CI remain unexecuted in these records. Native Windows
  was verified in the follow-up above; the original Linux milestone did not run
  Windows. POSIX-only signal/filesystem test mechanisms do not claim equivalent
  native Windows coverage.
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
