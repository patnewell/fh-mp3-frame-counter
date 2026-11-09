# Repository skills

Five unmodified official **Spec Kit 1.4.0 Lean** skills live in `.agents/skills/`.
Their [provenance](docs/spec-kit/provenance.json), [upstream description](docs/spec-kit/UPSTREAM.md)
and [license](docs/spec-kit/LICENSE) are included. The skills create ordinary
Markdown artifacts and require no global Spec Kit installation at invocation time.

| Skill                   | Result                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `$speckit-constitution` | Durable principles in `.specify/memory/constitution.md`      |
| `$speckit-specify`      | A new feature's observable contract in `spec.md`             |
| `$speckit-plan`         | Technical choices and verification approach in `plan.md`     |
| `$speckit-tasks`        | Ordered implementation and evidence tasks in `tasks.md`      |
| `$speckit-implement`    | Implement and verify the selected cycle                      |
| `$review-change`        | Review the complete change against its contract and evidence |

Invoke these in the Codex sidebar or CLI conversation. For a new feature, provide
the directory explicitly, for example:

```text
$speckit-specify Use feature directory specs/005-descriptive-change.
Describe the desired behavior, compatibility and observable acceptance here.
```

Then invoke `$speckit-plan`, `$speckit-tasks`, and `$speckit-implement` separately,
reviewing each result. Check `.specify/feature.json` before each stage. It selects
one active feature; it is not a registry of all features. See [the delivery map](specs/README.md).

One verified feature merge precedes the next feature specification. Small fixes
can amend their owning feature; substantial changes receive a new cycle. Review
skills complement executable checks and independent human review.
