# Delivery map

Bootstrap establishes the compiler, checks, project principles, and agent tooling.
The application is delivered through small, sequential Spec Kit Lean cycles:

| Cycle                                                                      | Observable outcome and evidence                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001 · Count uploaded MP3](001-count-uploaded-mp3/spec.md)                 | Verified and merged: working endpoint, indexed frames, original sample and useful errors. [Evidence](001-count-uploaded-mp3/verification.md).                                                    |
| [002 · Complete MP3 compatibility](002-complete-mp3-compatibility/spec.md) | Verified and merged: free-format/metadata, deterministic ambiguity and bounded search. [Evidence](002-complete-mp3-compatibility/verification.md).                                               |
| [003 · Bound upload resource use](003-bound-upload-resource-use/spec.md)   | App-owned admission and deadlines/cancellation retain capacity through actual disposal. [Evidence](003-bound-upload-resource-use/verification.md).                                               |
| [004 · Operate the service](004-operate-containerized-service/spec.md)     | Runtime validation, private logs, probes, bounded shutdown, image and CI. [Evidence](004-operate-containerized-service/verification.md) distinguishes configured and executed checks.            |
| [005 · Incremental parsing](005-incremental-mp3-parsing/spec.md)           | Direct asynchronous file-stream counting, bounded forward compatibility, no upload storage and independent large-input resource checks. [Evidence](005-incremental-mp3-parsing/verification.md). |

Completed artifacts remain as delivery history. Specify the next cycle after the
previous one is verified and merged. Early cycles are intermediate milestones,
not a claim that every final assignment requirement was already delivered then.
Tests and relevant documentation accompany each cycle; they are not deferred to
a final quality phase. A complete cycle has a short verification record with the
tested revision, actual commands, findings, and any remaining limits.

The constitution holds durable principles. Specifications describe observable
requirements; plans explain implementation choices. Feature 005 supersedes
seek-dependent free-format/suffix choices and filesystem responsibilities from
002–004. Its [matrix](005-incremental-mp3-parsing/spec.md#compatibility-matrix)
also replaces 003 U05's counting timing: provisional work starts during reception,
but success still waits for complete valid file, multipart and HTTP input.

## Inspect the sequence

The repository retains the original four feature branches and merge history,
plus the incremental 005 cycle. These read-only commands work in Linux/Unix shells,
macOS shells and Windows PowerShell:

```sh
git log --first-parent --reverse --oneline main
git log --all --graph --decorate --oneline
git log --reverse --oneline feature/002-complete-mp3-compatibility --not feature/001-count-uploaded-mp3
git log --reverse --oneline -- specs/003-bound-upload-resource-use src/upload
git log --reverse --oneline -- specs/005-incremental-mp3-parsing
```

The initial scaffold has no application feature spec. Within each subsequent
cycle, the specification, plan and tasks are distinct commits preceding the
behavior they govern. Each milestone was tested and merged before the next
specification was written. Narrow review corrections amend the owning feature
instead of manufacturing a new spec for every commit.

Tests established missing behavior before implementation: free-format rejection
in 002, excess-upload admission in 003 and absent readiness in 004. Later review
also exposed gaps after green tests, including APEv1 flags, child logger context
and disconnected readiness-probe ownership. The corresponding verification
records preserve those findings and fixes. This is evidence of an actual workflow,
not a claim that every line was written test-first or that agent review supplies
human approval.

For 005, an asynchronous-source acceptance case failed against the old path API
before the incremental parser implementation. Its new specification records the
necessary forward-only compatibility changes before those expectations changed.
Historical 001–004 results describe their original implementations, including
storage/disposal evidence that the streaming cycle supersedes.
