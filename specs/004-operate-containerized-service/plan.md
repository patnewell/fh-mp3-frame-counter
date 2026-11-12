# 004 · Implementation plan

Start from merged 003 with unchanged parser and upload ownership. Keep the
existing runtime dependencies and portable verification command.

## Runtime foundation

Add `src/config.ts` with one shared resolver/validator for programmatic values and
environment conversion. Return frozen primitive settings; only process entrypoints
read `process.env`. Preserve `createApp(options, operations)` and its explicit
`Application` result. Runtime logs default to info; programmatic tests remain
silent unless requested. Permit server port zero for isolated process tests.

Add actual create/write/remove storage probes to startup and readiness in
`app.ts`. Coalesce concurrent probes with one app-owned in-flight promise; do not
cache a completed result. Check admission again after awaited probing. Liveness
does not depend on storage and saturation is distinct from draining.

The close barrier also owns any in-flight storage probe, including one whose
readiness client has disconnected. Stop admission before capturing that promise;
do not report completed shutdown while its filesystem operations remain pending,
or turn a failed probe/removal into a successful close.

Add `healthcheck.ts` using built-in HTTP, a nonzero validated port, wildcard-to-
loopback host selection and an absolute two-second AbortSignal deadline. Consume
the response without retaining its body; exit silently with success only when
the readiness response completes successfully.

## Observable process lifecycle

Centralize the log serialization policy in small `src/logging.ts`. Use Fastify's
existing Pino integration and supported `LogController`, generated UUID request IDs
and typed allowlisted fields/events. Drop arbitrary messages, error/request/reply
objects and unsafe child bindings. Emit safe operational failures even after
timeout/disconnect; do not add another logging framework.

Keep signal/shutdown ownership in `server.ts`. The first termination signal stops
admission and begins `app.close()`. After the grace period, close active sockets
to invoke the already specified cancellation paths. After one additional second,
exit one if work is still unsettled. Settled cancellation can exit zero; repeated
signals do not reset timers. No second request registry or global upload state is
needed.

Expose a small `runServer(application, config)` entry with an `import.meta.main`
guard so a TypeScript child-process harness can use the existing count/dispose seam
while executing compiled shutdown code. This enables a deliberately unsettled
disposal regression without production test flags or global filesystem patches.

## Packaging and automation

Pin `node:24.22.3-bookworm-slim` to the verified official OCI index digest
`sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`.
Separate compilation, production dependency installation and the final runtime
payload. Root owns application files; the process runs as `node:node`.

The TypeScript Docker smoke uses argument-array child processes, unique owned
resource names, actual build/run/probe/upload/stop checks and finally cleanup.
Its launch policy is read-only root, 512 MiB noexec/nosuid temporary tmpfs,
1 GiB memory, one CPU, 128 PIDs, init, all capabilities dropped, no new privileges,
15-second stop timeout, and 256 MiB V8 old-space. tmpfs pages and other runtime
memory share the container limit; these defaults still require representative
capacity measurement before deployment.

Extend pinned-action CI to Ubuntu 24.04, macOS 15 and Windows 2025 and a Linux
Docker job. Explicitly use `npm.cmd` on Windows and publish failure-useful test
reports. A small PR template asks for linked acceptance, actual evidence and risks;
hosted protections remain a maintainer setup task, not a claimed repository feature.

## Verification and documents

Use shared config/probe tests first, then independent compiled-process tests from
an unrelated path with spaces. Exercise original sample, trace privacy, malformed
multipart, absolute probe deadlines, graceful drain, forced cancellation and final
exit bounds. Label Windows signal limitations; preserve prior tests and fixtures.

Complete the operations/development guides, final module/domain map, extension
decisions, lightweight team adoption/measurement guidance and acceptance matrix.
Keep instructions short and put detailed explanations in focused documents.
Apply independent review, run the clean full gate, attempt the real Docker smoke,
and report unavailable checks honestly. Package complete Git history, then
install and run the gate again from the actual extracted archive.
