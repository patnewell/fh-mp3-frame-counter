# Working in this repository

Read the README, the [constitution](.specify/memory/constitution.md), and the feature
selected by `.specify/feature.json`. Use [specs/README.md](specs/README.md) to identify
the owning capability. Load only documentation relevant to the change.

## Work map

| Change                          | Owner                                                  | Evidence                                            |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| MPEG framing and metadata       | `src/mp3/`                                             | Parser unit tests and real fixtures                 |
| Multipart and request resources | `src/upload/`, `src/app.ts`                            | Real HTTP and ownership/cancellation tests          |
| Runtime, probes and shutdown    | `src/config.ts`, `src/server.ts`, `src/healthcheck.ts` | Compiled process and container tests                |
| Agent/build policy              | `biome.json`, `.agents/`, `.codex/`, `.github/`        | Executable harness tests and a complete diff review |

## Commands at the repository root

| Action            | Linux/Unix                 | macOS                      | Windows PowerShell             |
| ----------------- | -------------------------- | -------------------------- | ------------------------------ |
| Install           | `npm ci --ignore-scripts`  | `npm ci --ignore-scripts`  | `npm.cmd ci --ignore-scripts`  |
| Unit tests        | `npm run test:unit`        | `npm run test:unit`        | `npm.cmd run test:unit`        |
| Integration tests | `npm run test:integration` | `npm run test:integration` | `npm.cmd run test:integration` |
| Full gate         | `npm run verify`           | `npm run verify`           | `npm.cmd run verify`           |
| Format            | `npm run format`           | `npm run format`           | `npm.cmd run format`           |

Use the pinned Node version. Integration/full test scripts build the executable
first. Do not assume that type stripping checks types or that configuration proves
execution. Record blocked checks accurately.

## Change workflow

For a new capability, changed contract, or significant architectural change:

1. Select a new explicit `specs/NNN-name` directory with `$speckit-specify`.
2. Review the observable requirements, then use `$speckit-plan` and `$speckit-tasks`.
3. Commit those artifacts before implementation. Invoke `$speckit-implement` for
   the selected cycle; test and document each usable increment.
4. Use `$review-change`, resolve findings, run the complete gate and record actual
   evidence. Merge the verified feature before beginning the next cycle.

Keep a small correction within its owning feature, with a failing regression and
an acceptance amendment when behavior changes. Do not create one spec per file or
commit. Do not rewrite completed evidence to suggest a different past workflow.
Use separate worktrees for concurrent features; each has its own feature pointer.

## Invariants

- Keep parser code independent of transport, configuration and upload policy.
- Derive fixture expectations independently; preserve the supplied sample bytes.
- Keep mutable state request/app-owned and retain capacity until work settles.
- Bound memory, work, bytes and elapsed time; explain ingress responsibilities.
- Exclude uploaded content, filenames, headers, raw URLs and paths from logs.
- Prefer direct typed code; comment ownership and non-obvious format decisions.
- Preserve checks and fixtures when fixing failures. Review any intentional gate
  change explicitly; instructions do not enforce runtime or hosted permissions.

Keep Git commits cohesive. Report the tested revision, results and limitations;
never invent human approval, execution, adoption, or delivery improvements.
