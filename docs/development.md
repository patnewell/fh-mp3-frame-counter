# Development workflow

## Install the pinned tools

Use Node **24.22.3** and its bundled npm. Install [Git](https://git-scm.com/install/).
The lockfile supplies TypeScript and the other project tools.

| Platform       | Node installation                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux/Unix     | Install [nvm-sh](https://github.com/nvm-sh/nvm#installing-and-updating), then run `nvm install` and `nvm use` at the repository root. Node availability depends on the Unix platform.       |
| macOS          | Use nvm-sh and the same two commands, or install the [official macOS package](https://nodejs.org/dist/v24.22.3/node-v24.22.3.pkg).                                                          |
| Native Windows | Install the [x64 MSI](https://nodejs.org/dist/v24.22.3/node-v24.22.3-x64.msi) or [ARM64 MSI](https://nodejs.org/dist/v24.22.3/node-v24.22.3-arm64.msi), then reopen PowerShell and VS Code. |

`nvm-sh` requires a POSIX shell; the MSI route is for native Windows. Run
`node --version` on every platform and expect `v24.22.3`. WSL is optional and uses
the Linux setup in a separate Linux checkout; do not share `node_modules` between
Windows and WSL.

## Commands at the repository root

Use `cd mp3-frame-counter` on Linux/Unix or macOS, or
`Set-Location mp3-frame-counter` in PowerShell when starting from the parent directory.

| Action            | Linux/Unix                        | macOS                             | Windows PowerShell                        |
| ----------------- | --------------------------------- | --------------------------------- | ----------------------------------------- |
| Locked install    | `npm ci --ignore-scripts`         | `npm ci --ignore-scripts`         | `npm.cmd ci --ignore-scripts`             |
| Full gate         | `npm run verify`                  | `npm run verify`                  | `npm.cmd run verify`                      |
| All tests         | `npm test`                        | `npm test`                        | `npm.cmd test`                            |
| Unit tests        | `npm run test:unit`               | `npm run test:unit`               | `npm.cmd run test:unit`                   |
| Integration tests | `npm run test:integration`        | `npm run test:integration`        | `npm.cmd run test:integration`            |
| Coverage          | `npm run test:coverage`           | `npm run test:coverage`           | `npm.cmd run test:coverage`               |
| Typecheck         | `npm run typecheck`               | `npm run typecheck`               | `npm.cmd run typecheck`                   |
| Lint / format     | `npm run lint` / `npm run format` | `npm run lint` / `npm run format` | `npm.cmd run lint` / `npm.cmd run format` |
| Compile           | `npm run build`                   | `npm run build`                   | `npm.cmd run build`                       |
| Run compiled app  | `npm start`                       | `npm start`                       | `npm.cmd start`                           |
| Watch source      | `npm run dev`                     | `npm run dev`                     | `npm.cmd run dev`                         |
| Fixture identity  | `npm run fixtures:verify`         | `npm run fixtures:verify`         | `npm.cmd run fixtures:verify`             |

Stop on a failed command. All-test, integration and coverage commands build first;
unit tests run source directly. Native Node type stripping does not replace the
strict compiler check. In PowerShell, `npm.cmd` avoids execution-policy issues with
the `npm.ps1` launcher; use `curl.exe` rather than the older PowerShell curl alias.
The README contains an upload command for each platform.

## VS Code and Codex

Open the repository folder. These commands work on Linux/Unix, macOS and Windows
PowerShell when the VS Code CLI is on PATH:

```sh
code --install-extension openai.chatgpt
code --install-extension biomejs.biome
code .
```

On macOS, use VS Code's [Shell Command setup](https://code.visualstudio.com/docs/setup/mac)
if `code` is unavailable. Launch the editor from a terminal using the pinned Node
version; background editor tasks may not load nvm startup scripts. Use
**Terminal > Run Task** for Verify, Build or Develop. Windows tasks select `npm.cmd`.

Sign into the Codex extension and read [AGENTS.md](../AGENTS.md). Repository skills
are in `.agents/skills/`; [SKILLS.md](../SKILLS.md) explains invocation and explicit
feature selection. `.codex/config.toml` requests workspace writes, on-request
approvals and no outbound command network. Project trust, managed requirements and
overrides affect active policy; the OS sandbox supplies enforcement. Network
installation, local HTTP tests or Docker may need permitted approval or a terminal
run. Report blocked checks as unexecuted; do not disable protections to hide them.

See official [Codex IDE](https://learn.chatgpt.com/docs/codex/ide),
[configuration](https://learn.chatgpt.com/docs/config-file/config-reference), and
[Windows](https://learn.chatgpt.com/docs/windows/windows-sandbox) documentation.

## One feature at a time

These Git commands work on Linux/Unix, macOS and PowerShell. Replace the uppercase
identity placeholders with your own values; settings affect this checkout only:

```sh
git config --local user.name "YOUR_NAME"
git config --local user.email "YOUR_EMAIL"
git status --short
git switch -c feature/005-descriptive-change
```

In Codex, invoke `$speckit-specify` with an explicit `specs/005-descriptive-change`
directory and observable requirements. Review its result, then invoke
`$speckit-plan` and `$speckit-tasks` separately. Commit each artifact before using
`$speckit-implement`. Keep implementation commits cohesive and include tests and
documentation with behavior. Use `$review-change` on the complete feature diff.

Run focused checks during development and the full gate on the finished diff.
Record the tested revision, actual results, review findings and limitations in the
feature's `verification.md`. Stage intended files in VS Code, inspect
`git diff --cached`, then commit. Merge a verified feature before creating the next
specification. For parallel features, use separate worktrees and feature pointers.

The constitution is project policy; feature specifications are contracts; plans
contain revisitable choices. Correct an existing defect with a regression in its
owning feature. A new capability, contract change or substantial architectural
change receives a new cycle. Preserve past verification as historical evidence.

## Environment and health checks

For a local port override, use the appropriate block at the repository root.
These set the current terminal's environment; the server inherits it.

**Linux/Unix and macOS**:

```sh
export PORT=3001
export LOG_LEVEL=info
node dist/server.js
```

After stopping with Ctrl+C, use `unset PORT LOG_LEVEL` to restore defaults.

**Native Windows PowerShell**:

```powershell
$env:PORT = '3001'
$env:LOG_LEVEL = 'info'
node dist/server.js
```

After Ctrl+C, use `Remove-Item Env:PORT, Env:LOG_LEVEL`.
`Stop-Process` is a forced termination and does not test POSIX graceful shutdown.

| Action                               | Linux/Unix                                          | macOS                                               | Windows PowerShell                                      |
| ------------------------------------ | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Liveness                             | `curl --include http://127.0.0.1:3001/health/live`  | `curl --include http://127.0.0.1:3001/health/live`  | `curl.exe --include http://127.0.0.1:3001/health/live`  |
| Readiness                            | `curl --include http://127.0.0.1:3001/health/ready` | `curl --include http://127.0.0.1:3001/health/ready` | `curl.exe --include http://127.0.0.1:3001/health/ready` |
| Compiled probe against the same port | `PORT=3001 node dist/healthcheck.js`                | `PORT=3001 node dist/healthcheck.js`                | `$env:PORT = '3001'; node dist/healthcheck.js`          |
| Inspect probe exit code              | `echo $?`                                           | `echo $?`                                           | `$LASTEXITCODE`                                         |

Run the exit-code command immediately after the probe. The probe deliberately
prints nothing. If overriding temporary storage, first create an absolute directory
that the process owns: use `mkdir -p /absolute/path/mp3-temp` on Linux/Unix/macOS,
or `New-Item -ItemType Directory -Force 'C:\\absolute\\path\\mp3-temp'` in PowerShell.
Set `UPLOAD_TEMP_DIR` using the environment syntax above. See
[operations](operations.md) for all values and resource constraints.

## Run the Linux container

Install [Docker Engine](https://docs.docker.com/engine/install/) on supported Linux,
or [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) on
macOS and [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
with Linux containers selected. Other Unix hosts need access to a supported Linux
Docker daemon. The commands below assume the selected Docker context is local;
remote contexts may not expose published loopback ports on the developer machine.

Use `npm run test:container` on Linux/Unix/macOS or `npm.cmd run test:container`
in Windows PowerShell for the automated build/run/cleanup check. No host dependency
installation is required by this script: it uses Node built-ins and installs
dependencies inside the build. It needs Docker access and registry/network access.

For a manually retained container, **each line below works in Linux/Unix shells,
macOS shells and native Windows PowerShell**. The single-line launch avoids
platform-specific continuation characters. Stop any local server on port 3000.

```sh
docker build --tag mp3-frame-counter .
docker run --detach --name mp3-frame-counter --read-only --init --cap-drop ALL --security-opt no-new-privileges --cpus 1 --memory 1g --pids-limit 128 --tmpfs /tmp:rw,noexec,nosuid,size=512m,mode=1777 --stop-timeout 15 --publish 127.0.0.1:3000:3000 mp3-frame-counter
docker inspect --format '{{.State.Health.Status}}' mp3-frame-counter
docker logs mp3-frame-counter
```

Wait for health to become `healthy`, then use the platform-specific upload command
in the README and expect 6090. To stop and remove this named container on any of
the three platforms:

```sh
docker stop mp3-frame-counter
docker inspect --format '{{.State.ExitCode}}' mp3-frame-counter
docker rm mp3-frame-counter
```

Expect exit code zero for a clean idle stop. `docker stop` tests Linux SIGTERM
behavior even when the host is macOS/Windows. Image settings alone do not apply
the resource restrictions in the launch command.

## Team use and human ownership

Keep a feature small enough for one engineer to explain its contract, main code
path, failure behavior and tradeoffs. Before accepting agent output, that engineer
should trace an unfamiliar fixture or failure through the code, predict its result
and verify it. A second reviewer should challenge at least one assumption the
implementation's tests might share. The PR template asks for an accountable owner,
linked acceptance and actual evidence; an agent's self-review is not human approval.

A plausible next cycle might add a content digest to a separately specified
response, extend framing to another MPEG version, or replace temporary staging
with streaming. Choose one. Keep a compatibility regression, specify resource
and error behavior, and load only the relevant parser/upload/operations guides.
A durable job queue or transcription workflow requires a deliberate domain
decision; see [architecture](architecture.md#future-changes).

For first-team adoption, ask a second engineer to use a fresh checkout and complete
one bounded change using the README, Lean skills and review checklist. Record
setup failures, unclear guidance, review rework and any oral help required. Fix the
observed friction rather than increasing every agent prompt.

Measure **net delivery**, including review, debugging and rework: compare similar
small tasks with and without the harness, recording elapsed/active engineering
time, escaped defects and agent cost. A small pilot has confounders; do not turn
commit counts, generated lines or test coverage into a productivity claim.
This repository supplies a repeatable workflow, not measured team adoption or
proof of improved delivery.

The typechecker, Biome import boundary, fixture/provenance tests, coverage gate
and real integration cases are executable checks. Markdown instructions and
`.codex/config.toml` are editable inputs, not an authorization boundary. Configure
the hosted repository to require the application matrix and container checks,
independent approval, protected policy/workflow files and controlled bypass
permissions. Review changes to gates and fixtures explicitly. These hosted
controls cannot be established by a source archive and have not been claimed as
enabled here. Keep secrets out of agent context; active sandbox/network policy is
owned by the developer platform.

The workflow favors concise repository guidance and focused skills, following
[Playwright's repository guidance](https://github.com/microsoft/playwright/blob/main/AGENTS.md)
and Thoughtworks' [agent instruction bloat warning](https://www.thoughtworks.com/en-us/radar/techniques/agent-instruction-bloat).
Add a deterministic check when a recurring mistake can be checked mechanically;
add prose when it explains a decision that requires judgment.
