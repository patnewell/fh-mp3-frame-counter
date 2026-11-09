# MP3 frame counter

A TypeScript/Fastify service for counting physical MPEG-1 Layer III frames.
The [assignment](docs/assignment.pdf) defines the externally required behavior.

Development starts with the toolchain and project principles. Each subsequent
capability is specified, planned, implemented, verified, and merged independently.
See [the delivery map](specs/README.md) for the intended increments.

Use Node **24.22.3**. From the repository root:

| Action                  | Linux/Unix                | macOS                     | Windows PowerShell            |
| ----------------------- | ------------------------- | ------------------------- | ----------------------------- |
| Install locked packages | `npm ci --ignore-scripts` | `npm ci --ignore-scripts` | `npm.cmd ci --ignore-scripts` |
| Typecheck               | `npm run typecheck`       | `npm run typecheck`       | `npm.cmd run typecheck`       |
| Lint                    | `npm run lint`            | `npm run lint`            | `npm.cmd run lint`            |
| Format                  | `npm run format`          | `npm run format`          | `npm.cmd run format`          |

Application run and acceptance instructions accompany the first working feature.
