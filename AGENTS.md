# Agent workflow

How coding agents work in this repository (owner, 13 Oct 2026). Project rules, release gates
and history live in `HANDOFF.md`; this file only covers agent tooling.

## Delegation

Pi + Claude is the main agent. Child agents run only through T3 `delegate_task` with an
explicit OpenCode target:

```json
{ "providerInstanceId": "opencode", "model": "9router/gemini-3.8-flash-high" }
```

`~/.pi/agent/extensions/t3-delegation-guard.ts` enforces this. It blocks Claude targets,
omitted targets and Pi-native subagents. If a delegation is blocked or OpenCode is down,
do the work yourself or report BLOCKED. Never retry on a Claude model.

## Pstack skills

Pstack is installed in `~/.agents/skills/`. Most of its skills set `disable-model-invocation`,
so they are not in the skill list. Read the `SKILL.md` directly when a task fits:

| Task | Skill |
|---|---|
| What a change could break, before merge | `blast-radius` |
| Bug fix or behaviour change with a cheap test target | `tdd` |
| Adversarial code review | `interrogate` (reviewers: you, then OpenCode via `delegate_task`) |
| Long or unattended work that needs a decision trail | `show-me-your-work` |
| Before declaring a task done | `principle-prove-it-works` |
| Multi-step work in the house style | `poteto-mode` |

Skip them for questions and one-line changes.

## Reporting skill use

A skill counts as used only when its `SKILL.md` was read in this session and its steps were
followed. For each engineering task, report: skill, `SKILL.md` path loaded (yes/no), steps
executed, steps skipped and why, and the evidence (tool calls, test output). Following a
similar practice without reading the skill is not skill use.

All CI, release and security gates in `HANDOFF.md` and `.github/workflows/` still apply.
