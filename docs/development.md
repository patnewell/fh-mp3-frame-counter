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
