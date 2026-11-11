# Delivery map

Bootstrap establishes the compiler, checks, project principles, and agent tooling.
The application is delivered through small, sequential Spec Kit Lean cycles:

| Cycle                                                                      | Observable outcome and evidence                                                                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001 · Count uploaded MP3](001-count-uploaded-mp3/spec.md)                 | Verified and merged: working endpoint, indexed frames, original sample and useful errors. [Evidence](001-count-uploaded-mp3/verification.md).      |
| [002 · Complete MP3 compatibility](002-complete-mp3-compatibility/spec.md) | Verified and merged: free-format/metadata, deterministic ambiguity and bounded search. [Evidence](002-complete-mp3-compatibility/verification.md). |
| [003 · Bound upload resource use](003-bound-upload-resource-use/spec.md)   | App-owned admission and request deadlines/cancellation retain capacity through actual disposal; real HTTP lifecycle evidence.                      |
| 004 · Operate the service                                                  | Runtime validation, safe logs, probes, graceful drain and container/CI verification.                                                               |

Only the active cycle has work in progress; completed artifacts remain as delivery
history. Specify the next cycle after the previous one is verified and merged.
Early cycles are intermediate milestones,
not a claim that every final assignment requirement has already been delivered.
Tests and relevant documentation accompany each cycle; they are not deferred to
a final quality phase. A complete cycle has a short verification record with the
tested revision, actual commands, findings, and any remaining limits.

The constitution holds durable principles. Specifications describe observable
requirements; plans explain implementation choices, including temporary storage.
