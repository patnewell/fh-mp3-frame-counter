# MP3 service constitution

Version 1.0.0 · 2026-11-11

1. **Deliver the assignment.** Count physical MPEG-1 Layer III frames from bytes;
   never obtain counts from a media parsing package, duration, or an advertised
   total. Preserve the supplied sample and independently established test oracles.
2. **Keep the implementation understandable.** Use strict TypeScript for all
   executable project code, cohesive modules and descriptive names. Explain
   format rules and ownership in comments; avoid generic layers and global state.
3. **Separate requirements from choices.** Specifications define observable
   behavior and resource guarantees. Plans explain algorithms, frameworks and
   storage choices. Do not make an implementation detail a permanent principle.
4. **Own and bound work.** Make request and application resource lifetimes explicit.
   Bound bytes, memory, elapsed work and concurrency; cancellation does not prove
   work has settled. Replicas must not depend on local state from earlier requests.
5. **Develop in small specification cycles.** Give each cohesive capability or
   substantial contract change its own Lean spec, plan and task list before code.
   Complete and verify that cycle before selecting the next. Ordinary corrections
   stay with their owning feature and include a regression.
6. **Show evidence.** Use independent fixture expectations, focused unit tests and
   real HTTP/process integration tests. Record actual verification with its
   revision and remaining limits. Never present a configured check as executed.
7. **Keep agent guidance focused.** Load relevant context, use executable lint,
   type and test checks, and review complete changes. Human ownership and hosted
   protections are distinct from advisory repository instructions.
8. **Support every documented platform.** Give explicit Linux/Unix, macOS and
   native Windows commands. Avoid shell-specific executable project scripts.

Amend these principles only when a durable project policy changes. Keep feature
contracts and implementation decisions in their owning artifacts.
