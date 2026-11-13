# 005 · Implementation tasks

## Domain increment

- [x] [T01] Add failing async-input/chunk/progress regressions in `tests/unit/mp3/` and adapt `tests/helpers/mp3.ts`; implement the bounded forward parser in `src/mp3/`, retaining mandatory fixture evidence in `tests/integration/fixtures.test.ts`. Replace obsolete seek tests with stream carry/backpressure/cancellation tests and explicitly migrated ambiguity expectations. Run focused parser checks and commit this usable increment before T02.

## Streaming service increment

- [x] [T02] Pass the actual file stream to the parser and retain settled stream/parser/rejection ownership in `src/upload/route.ts` and `src/upload/lifetime.ts`; remove storage from `src/app.ts`, `src/config.ts`, `src/logging.ts`, HTTP/process helpers and obsolete fixtures. Adapt/add real HTTP, lifecycle, readiness, config, privacy and compiled shutdown regressions throughout `tests/`. Within this increment, implement independent `scripts/`/Docker/resource checks and update affected current `README.md`, `docs/`, `AGENTS.md`, `SKILLS.md`, `.github/`, `.env.example` and `specs/README.md`. Run focused domain/HTTP/runtime checks and commit cohesive source/test and deployment/documentation changes before T03.

## Review and completion

- [x] [T03] Apply `review-change` to the complete feature diff from `2c91eba`; resolve findings, scan for stale storage assumptions and accidental buffering, run `npm.cmd run verify` on pinned Node, execute the isolated resource check and attempt both Docker checks. Record actual revision/results, compatibility/test replacements, review dispositions and blocked environments in `verification.md`, commit evidence, run the clean final gate and merge the verified feature locally. Preserve existing history/tags and push nothing.

## Existing service clarification

- [x] [T04] Remove `scripts/resource-server.ts`; make `scripts/resource-check.ts` launch the existing `dist/server.js` with a measurement-only preload in `scripts/resource-monitor.ts`. Assert/report the actual entrypoint, add a normal-entrypoint pre-EOF HTTP regression, update current documentation and record actual review/gate/resource results without rewriting earlier evidence.

## File-size policy correction

- [x] [T05] Establish a failing lazy HTTP upload above the former 100 MiB cap, remove total file-byte configuration/enforcement and resource-check size overrides, retain concurrency/deadlines/structural limits and invalid-media recovery, comment the active-upload count as a Kubernetes HPA custom metric, update current docs, review the full correction and record actual full-gate/native-resource results.

## Configuration simplification

- [x] [T06] Establish failing standard-coercion regressions, replace custom configuration validation with pinned `env-schema` and shared declarative constraints, preserve defaults/isolation/startup privacy, update affected tests and current docs, review the complete correction and record the full gate's actual results.

## Free-format readability

- [x] [T07] Separate byte-window mechanics from MPEG compatibility, explain and name padded/unpadded lengths and consumed-header ownership, add a worked MP3-guide example and header-split coverage, preserve all framing/search/stream bounds, review the full correction and record actual verification.

## Directory readability

- [x] [T08] Resolve the directory assessment's six clarity findings in the existing modules: explain metadata traversal/limits/lengths, make counting phases and header ownership explicit, name MPEG fields and reader coordinates/contracts, align free-format names, preserve behavior and fixtures, update the guide, review the complete diff and record the focused/full/resource checks actually run.
