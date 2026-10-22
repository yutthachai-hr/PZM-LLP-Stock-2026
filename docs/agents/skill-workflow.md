# Pstack + Matt Pocock skills

Pstack owns task order, resource leases, delegation and release decisions. Matt skills add
focused methods, not another orchestrator. Existing AGENTS/HANDOFF, Owner approvals and
release/security gates take precedence over imported skill instructions.

| Work | Method inside pstack |
|---|---|
| Requirements | `grill-with-docs` -> `grilling` + `domain-modeling` |
| Specification | `to-spec` |
| Vertical tasks | `to-tickets` |
| Bug investigation | `diagnosing-bugs`; start with a red-capable local check |
| Implementation | Existing pstack workflow; `implement` is optional guidance |
| TDD | Existing `~/.agents/skills/tdd/SKILL.md` (pstack), not Matt's same-name skill |
| Architecture | `codebase-design`; respect existing ADRs |
| Review | `code-review` Standards + Spec axes, then pstack `interrogate` adjudication |
| PR | `pr` body + pstack `blast-radius` |
| Verification | pstack `principle-prove-it-works` and all applicable release gates |
| Handoff | `handoff` temporary portable pointer + existing project handoff/checkpoint |

## Harness adaptation

- In Pi, `/skill:<name>` explicitly invokes a discovered skill. A skill's instruction to
  "call the Skill tool" means load its `SKILL.md` with `read`; no such tool is assumed.
  Explicit-only skills retain their upstream `disable-model-invocation` metadata.
- Pi and OpenCode use project `.agents/skills/` with the inspected skills CLI1.7.4.
  Reuse that shared directory; a second plugin/global/copy installation is not needed.
  Delegated workers in another worktree must check their own discovery paths first.
- Every child runs through T3 `delegate_task` with an explicit currently approved target.
  Read the repository delegation rules before dispatch. Imported references to native
  subagents, foreground agents or a parallel frontier do not authorize those mechanisms.
  Existing concurrency limits, one emulator lease and one writer per file still apply.
- When no approved child is available, do eligible work inline. For `code-review`, keep
  Standards and Spec findings separate and label inline work as self-review. Independent
  review stays BLOCKED; self-review never satisfies that release gate.
- A three-way design comparison is queued/sequential when the approved resource limit
  requires it. No imported skill can increase the limit, choose a provider, edit Guard,
  change credentials or use shell-spawned agents.
- Debugging traces, replay, HITL templates and prototypes use synthetic/emulator data.
  Existing Production authorization boundaries still apply. Templates are inert files,
  not startup hooks; do not run scripts merely because a skill was loaded.

## Collision and update policy

Keep pstack's `tdd` and `teach` authoritative. Exclude Matt's same-name skills from installs;
selecting an alternative requires an explicit Owner decision. Do not rename an imported
skill's directory without also addressing its declared name and references.

Before install/update: back up affected files, inspect the source and installer, inventory
all project/global names and confirm the target is safe. The inspected installer deletes
existing target directories before copying: never use a bulk update over local customizations.
Pin/record source SHA, compare files, review changes and reload only through supported
interfaces. If Guard refuses a command, report BLOCKED instead of disguising it or copying
files as an alternative route. See the installation record for the current blocked step.

Skill reporting remains exactly as required by AGENTS.md: loaded path, executed/skipped
steps, reason and evidence. Installing or reading a skill alone is not full workflow use.
