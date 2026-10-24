# Matt skills integration record — 22 Oct 2026

## State

Configuration candidate only; **new installation and live runtime discovery BLOCKED**.
This PR contains instructions/setup docs, not a new skill payload, plugin or runtime change.
It must not be described as a completed installation on every clone/worktree.

Source: https://github.com/mattpocock/skills
Audited source SHA: `5beb35b040e3de97e54fa9e386d7e42d15c295c2`.
Official installer resolved to `skills@1.7.4`, npm integrity
`sha512-lHZJksE8UImNAr+LL6unqq7jERjdFw5EJasm17srycwL7rXHGdCmgu1L1ttLxUO9i3rdH+QQig+px0icHqLmRw==`.

## Existing installation and selected methods

Preflight found38 untracked Matt skill folders plus `skills-lock.json` already present in
`C:/Users/Yutthachai/pzm-r25-rnd-other/.agents/skills/`. They were not installed by this task.
These13 selected folders were byte-compared with the audited SHA and matched:

`setup-matt-pocock-skills`, `grill-with-docs`, `to-spec`, `to-tickets`, `diagnosing-bugs`,
`implement`, `codebase-design`, `code-review`, `pr`, `handoff`, `domain-modeling`,
`grilling`, `writing-for-agents`.

Existing raw installation also collided with global pstack at `tdd` and `teach`. After a
failing-before collision check, those two untracked Matt folders were moved intact outside
skill discovery and their entries removed from the untracked Matt lockfile. Nothing in
global pstack was replaced. The remaining36 local names have no collision with the global
pstack inventory. Other preexisting skill folders were preserved; only the selected13 and
their support files received the source-aware review in this task.

Backups, quarantined originals and detailed receipts are external to Git at
`C:/Users/Yutthachai/pzm-skill-install-audit-20261022/` (`backups/`, `quarantine/`).
The main/R25/hotfix feature commits were not merged into this configuration branch.

## Installation blocker

The official command was prepared with the selected names, project scope, telemetry off
and package lifecycle scripts disabled:

```sh
npx skills@latest add mattpocock/skills -a pi
```

Existing Guard rejected the shell command before execution because it interpreted `pi`
as starting a runtime. No install log/target was created. Do not change spelling, target,
transport or copy files to evade that refusal. Guard/model policy remains Owner-managed.
An earlier read-only shell search of the installed runtime path was rejected too.

The inspected installer uses `.agents/skills/` for both Pi and OpenCode. A separate OpenCode
install would write the same target, so it was not attempted. No global or plugin install.

## Setup and safety

`setup-matt-pocock-skills` was read from the existing installation and its prompt-driven
setup was applied to this configuration branch once. Owner preauthorized choices replace
extra confirmation prompts: GitHub Issues, existing-label/body-state mapping, single-context
lazy docs. AGENTS.md gained one pointer block; existing content/HANDOFF/ADRs/release policy
and model files are preserved. No GitHub label/issue writes or hooks were needed.

Manual security verdict: **CAUTION**. SkillSpector CLI was absent; no numeric scan score is
claimed. Selected content matches the purpose but recommends native/parallel agents and
trace/HITL use; project adaptations in skill-workflow.md constrain those actions. No bundled
skill script was executed, no provider launched and no credentials/Production data accessed.
Installer overwrite behavior was reviewed: it recursively removes an existing target before
copying. A future approved install must use an empty or explicitly reviewed/backed-up target.
Optional skills.sh telemetry/audit requests should be disabled during that install.

## Verification and remaining gates

- Baseline unit suite on main2c759f7f:1658 passed before configuration edits.
- Collision check: RED `tdd`/`teach` -> GREEN after quarantine; real file paths/hashes prove
  distinct definitions, and the two originals still match upstream. Global pstack backup
  comparison passes unchanged; pstack tdd/interrogate/prove-it instructions remain readable.
- Selected13 folders match audited source; actual existing setup/diagnosis/review SKILL.md
  files were loaded with the read tool. This is filesystem/read validation, not live Pi
  slash-command discovery or a successful OpenCode child invocation.
- Example diagnosis used the collision check as its local feedback loop. Example review
  keeps Standards/Spec axes separate inline; independent review is a separate release gate.
- Live Pi reload/command discovery and an approved OpenCode child remain BLOCKED/UNVERIFIED;
  no Guard bypass or routing fallback is authorized. No independent approval is claimed.
- No application, dependency, CI, Rules, deployment or business-data files are changed by
  this PR. Final verification receipts and PR checks must be read before any merge.

Rollback: revert the documentation commit. Locally, the quarantined folders/lock snapshot
can restore the preflight state, but doing so reintroduces the documented name collisions.
