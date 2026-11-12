# 004 · Implementation tasks

- [x] [T01] Add shared immutable settings in `src/config.ts`, storage-aware probes in `src/app.ts` and the compiled `src/healthcheck.ts`; verify configuration and real probe behavior before the next phase.
- [ ] [T02] Make the compiled deployment operable: add safe logs and bounded shutdown in `src/logging.ts`/`src/server.ts`, independent compiled-process regressions in `tests/integration/`, and the Docker/portable smoke/CI files. Runtime, independent process tests and packaging can proceed in parallel after T01's contract is verified.
- [ ] [T03] Complete README and `docs/` including operations, all-platform commands, domain extension choices, team AI ownership and the final acceptance map; review the complete feature and resolve findings.
- [ ] [T04] Run the clean full gate, attempt the Docker smoke, record actual results/remaining qualifications in `verification.md` and `docs/verification.md`, and merge the verified operational feature.

After the feature merge, create the repository archive with complete Git history,
check its objects and identities, then install and rerun the gate from its actual
extraction. Record that release check accurately; it is packaging verification,
not another application feature or a rewritten earlier milestone.
