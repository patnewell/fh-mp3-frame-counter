# 003 · Implementation tasks

- [x] [T01] Add app-owned capacity in `src/upload/admission.ts` and focused unit tests; establish a failing real-HTTP admission acceptance case before route integration.
- [ ] [T02] Implement request cancellation/deadline ownership and bounded rejection handling in `src/upload/`, connect `src/app.ts` and `src/server.ts`, and add real HTTP lifecycle regressions.
- [ ] [T03] Update README, architecture, `docs/testing.md` and the delivery map with resource ownership, ingress limits and actual test seams; independently review and resolve findings.
- [ ] [T04] Run the complete gate on a clean revision, record evidence/limits in `verification.md`, and merge before selecting 004.
