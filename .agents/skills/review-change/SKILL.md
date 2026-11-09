---
name: review-change
description: Review a complete feature or maintenance diff against its specification, resource ownership, regression evidence and deployment contract. Use before feature completion or when reviewing a parser, upload lifecycle, runtime or agent-policy change.
---

# Review a change

Read AGENTS.md, the selected feature artifacts, and the complete diff from its
base. Inspect affected callers, tests and deployment settings as needed.

1. Identify the observable behavior and the constraints that must remain true.
2. Follow success, invalid input, cancellation, overload and cleanup paths.
3. Challenge parser boundaries and independent fixture expectations. For lifecycle
   work, distinguish response completion from actual settled work.
4. Check changed checks, exclusions and instructions as carefully as application
   code. A passing gate does not validate an altered oracle automatically.
5. Reproduce a suspected defect with the narrowest counterexample. Do not invent
   a failure or request unrelated framework work.
6. Report findings in severity order with file, consequence and concrete evidence.
   State explicitly when none remain, and name unexecuted or uncertain checks.
7. Record findings and disposition in the active feature's verification record.
   Human approval, adoption and delivery savings require separate evidence.
