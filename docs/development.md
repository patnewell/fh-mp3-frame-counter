# Development

Start with the [README](../README.md) to install dependencies, verify the project
and upload the sample. This guide covers editor setup, commands and local deployment.

## Install the pinned tools

Use **Node 24.22.3**, its bundled npm, and Git. The lockfile supplies TypeScript,
Vitest, Biome and the other project dependencies.

| Platform           | Setup                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux/Unix         | Install [nvm-sh](https://github.com/nvm-sh/nvm#installing-and-updating), then run `nvm install` and `nvm use` from the repository root.                     |
| macOS              | Use nvm-sh with the same commands, or select version 24.22.3 and the macOS installer on the [Node download page](https://nodejs.org/en/download).           |
| Windows PowerShell | Select version 24.22.3 and the Windows MSI for your CPU architecture on the [Node download page](https://nodejs.org/en/download), then reopen the terminal. |

Run `node --version` and expect `v24.22.3`. WSL uses the Linux setup in a separate
checkout; keep its dependency installation separate from native Windows.

## Commands at the repository root

| Action                      | Linux/Unix and macOS               | Windows PowerShell                     |
| --------------------------- | ---------------------------------- | -------------------------------------- |
| Install locked dependencies | `npm ci --ignore-scripts`          | `npm.cmd ci --ignore-scripts`          |
| Full verification           | `npm run verify`                   | `npm.cmd run verify`                   |
| All tests                   | `npm test`                         | `npm.cmd test`                         |
| Unit tests                  | `npm run test:unit`                | `npm.cmd run test:unit`                |
| Integration tests           | `npm run test:integration`         | `npm.cmd run test:integration`         |
| Coverage                    | `npm run test:coverage`            | `npm.cmd run test:coverage`            |
| Typecheck                   | `npm run typecheck`                | `npm.cmd run typecheck`                |
| Lint                        | `npm run lint`                     | `npm.cmd run lint`                     |
| Format                      | `npm run format`                   | `npm.cmd run format`                   |
| Build                       | `npm run build`                    | `npm.cmd run build`                    |
| Run compiled app            | `npm start`                        | `npm.cmd start`                        |
| Watch source                | `npm run dev`                      | `npm.cmd run dev`                      |
| Verify fixture identities   | `npm run fixtures:verify`          | `npm.cmd run fixtures:verify`          |
| Native resource check       | `npm run test:resources`           | `npm.cmd run test:resources`           |
| Container smoke test        | `npm run test:container`           | `npm.cmd run test:container`           |
| Container resource check    | `npm run test:resources:container` | `npm.cmd run test:resources:container` |

`verify` runs lint, typechecking, a clean build and tests with coverage. All-test,
integration, coverage and native resource commands build first; unit tests run
source directly. Development mode uses Node's type stripping, so run the compiler
check before committing. Build before using `npm start` on a fresh checkout.

In PowerShell, `npm.cmd` avoids execution-policy issues with the `npm.ps1` launcher.
Use `curl.exe` for the upload examples to avoid PowerShell's curl alias.

## Editor setup

VS Code is optional. With its CLI on PATH, run:

```sh
code --install-extension biomejs.biome
code .
```

On macOS, follow VS Code's [shell command setup](https://code.visualstudio.com/docs/setup/mac)
if `code` is unavailable. Open the editor from a terminal using the pinned Node
version. The repository configures TypeScript formatting on save and supplies
**Verify**, **Build** and **Develop** tasks under **Terminal > Run Task**.
Windows tasks use `npm.cmd`.

## Making a change

Follow the request through [the architecture](architecture.md), then read the
relevant parser, upload or runtime tests. Keep changes focused and include tests
for changed behavior. The [testing guide](testing.md) explains test ownership,
fixtures and shared helpers.

Run focused tests while editing and `verify` before committing. Review the diff,
including changes to fixtures, dependency pins and checks. Record commands and
results accurately; a configured check is separate from one that has run.

## Environment and health checks

Set environment variables in the terminal that will start the server. These
examples assume the compiled app exists.

**Linux/Unix and macOS:**

```sh
export PORT=3001
export LOG_LEVEL=info
npm start
```

After stopping with Ctrl+C, run `unset PORT LOG_LEVEL` to restore the defaults.

**Windows PowerShell:**

```powershell
$env:PORT = '3001'
$env:LOG_LEVEL = 'info'
npm.cmd start
```

After Ctrl+C, run `Remove-Item Env:PORT, Env:LOG_LEVEL`.

From another terminal:

| Check                    | Linux/Unix and macOS                                | Windows PowerShell                                      |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------- |
| Liveness                 | `curl --include http://127.0.0.1:3001/health/live`  | `curl.exe --include http://127.0.0.1:3001/health/live`  |
| Readiness                | `curl --include http://127.0.0.1:3001/health/ready` | `curl.exe --include http://127.0.0.1:3001/health/ready` |
| Compiled readiness probe | `PORT=3001 node dist/healthcheck.js`                | `$env:PORT = '3001'; node dist/healthcheck.js`          |
| Probe exit code          | `echo $?`                                           | `$LASTEXITCODE`                                         |

Inspect the exit code immediately after running the probe. It prints nothing and
returns zero only when readiness succeeds. See [operations](operations.md) for
all configuration values and shutdown behavior.

## Run the Linux container

Install [Docker Engine](https://docs.docker.com/engine/install/) on Linux, or
[Docker Desktop for macOS](https://docs.docker.com/desktop/setup/install/mac-install/)
or [Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
Select Linux containers. Other Unix hosts need access to a Linux Docker daemon.

For automated build, smoke testing and cleanup, use `npm run test:container`
(Linux/Unix and macOS) or `npm.cmd run test:container` (PowerShell). The script
uses Node built-ins, with dependency installation inside Docker. Docker access
and network access to the image and package registries are required.

For a manual launch, each line below works in Linux/Unix shells, macOS shells
and Windows PowerShell. Stop any local server on port 3000 first. These commands
assume a local Docker context; a remote daemon publishes ports on its own host.

```sh
docker build --tag mp3-frame-counter .
docker run --detach --name mp3-frame-counter --read-only --init --cap-drop ALL --security-opt no-new-privileges --cpus 1 --memory 1g --pids-limit 128 --stop-timeout 15 --publish 127.0.0.1:3000:3000 mp3-frame-counter
docker inspect --format '{{.State.Health.Status}}' mp3-frame-counter
docker logs mp3-frame-counter
```

Wait for health to become `healthy`, then upload the sample using the README
command and expect 6090 frames. To stop and remove this container:

```sh
docker stop mp3-frame-counter
docker inspect --format '{{.State.ExitCode}}' mp3-frame-counter
docker rm mp3-frame-counter
```

An idle graceful stop should return exit code zero. The container runs with a
read-only root and requires no writable upload mount. Its Linux process receives
SIGTERM from `docker stop`, including on macOS and Windows hosts.

See [operations](operations.md#container-policy-and-memory) for deployment limits
and [resource checks](testing.md#large-input-resource-checks) for the separate
256 MiB container memory test.
