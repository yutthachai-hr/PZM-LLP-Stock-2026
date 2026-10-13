# Agent workflow

How coding agents work in this repository (owner, 13 Oct 2026). Project rules, release gates
and history live in `HANDOFF.md`; this file only covers agent tooling.

## Delegation

Pi + Claude is the main agent. Child agents run only through T3 `delegate_task` with an
explicit OpenCode target:

```json
{ "providerInstanceId": "opencode", "model": "9router/gemini-3.8-flash-high" }
```

`9router/gemini-3.8-flash-medium` is the only other approved model.

The local Pi extension `~/.pi/agent/extensions/t3-delegation-guard.ts` enforces this. Its
allow-list is `~/.pi/agent/delegation-policy.json`, and decisions are logged to
`~/.pi/agent/delegation-guard.log`. It blocks:

- `delegate_task`, `create_threads` and `t3_thread_launch` with an omitted target, any
  provider other than `opencode`, a missing model, a Claude model, or an unlisted model
- `schedule_task`, `run_scheduled_task_now`, `t3_thread_fork` and `t3_thread_configure`,
  which run on the thread's inherited Pi + Claude model
- `t3_thread_send` to any thread that isn't the child of an approved OpenCode task
- native subagent tools (`AskClaude`, `task`, `agent`, `subagent`, `spawn_agent`)
- shell commands that start `pi` or `claude`, or call T3's MCP transport

If the policy file is missing or invalid, every delegation is blocked. If a delegation is
blocked or OpenCode is down, do the work yourself or report BLOCKED. Never retry on a
Claude model. If no independent (non-Claude) reviewer is available, report the review as
BLOCKED.

Pstack's per-role models are in `~/.agents/pstack-models.md`. `inherit-parent` means the
main agent does that role inline, without spawning a child.

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
