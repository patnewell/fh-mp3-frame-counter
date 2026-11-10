# Delivery map

Bootstrap establishes the compiler, checks, project principles, and agent tooling.
The application is delivered through small, sequential Spec Kit Lean cycles:

| Cycle                                                                      | Observable outcome and evidence                                                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [001 · Count uploaded MP3](001-count-uploaded-mp3/spec.md)                 | Verified and merged: working endpoint, indexed frames, original sample and useful errors. [Evidence](001-count-uploaded-mp3/verification.md). |
| [002 · Complete MP3 compatibility](002-complete-mp3-compatibility/spec.md) | Free-format and metadata cases with independent fixtures, deterministic ambiguity rules and file-owned search limits.                         |
| 003 · Bound upload resource use                                            | Large, concurrent, stalled and cancelled uploads have bounded resource impact.                                                                |
| 004 · Operate the service                                                  | Runtime validation, safe logs, probes, graceful drain and container/CI verification.                                                          |

Only the active cycle has work in progress; completed artifacts remain as delivery
history. Specify the next cycle after the previous one is verified and merged.
Early cycles are intermediate milestones,
not a claim that every final assignment requirement has already been delivered.
Tests and relevant documentation accompany each cycle; they are not deferred to
a final quality phase. A complete cycle has a short verification record with the
tested revision, actual commands, findings, and any remaining limits.

The constitution holds durable principles. Specifications describe observable
requirements; plans explain implementation choices, including temporary storage.
