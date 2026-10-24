# Agent workflow

How coding agents work in this repository (owner, 13 Oct 2026). Project rules, release gates
and history live in `HANDOFF.md`; this file only covers agent tooling.

## Delegation

**Owner decision R60-H (24 Oct 2026).** The custom delegation guard is retired. It is disabled in
Pi settings (`-extensions\t3-delegation-guard.ts` in `~/.pi/agent/settings.json`); its source,
policy and log stay on disk unchanged, and there is no model allow-list. T3/Pi native permission
modes are the only gate.

MAIN is Pi + Claude; Pi + OpenAI Codex is MAIN backup only. Never switch MAIN to Qwen.

**Owner policy R62 (24 Oct 2026): strictly no OpenAI or Claude subagents.** Never delegate to
ChatGPT, any GPT, OpenAI Codex, GPT-OSS or Claude, through any provider (Pi, OpenCode, 9Router or
other), for any purpose: coding, review, research, health or reachability probe, fallback or
background work. To check Codex MAIN, use the MAIN runtime, not delegation. Test this policy by
inspecting config and with mocks, never by probing a forbidden model.

Child agents run through T3 `delegate_task` with an explicit target, in this order:

| # | Target | When |
|---|---|---|
| 1 | `opencode` / `9router/gemini-3.8-flash-high` | default worker and independent reviewer |
| 2 | `opencode` / DeepSeek | when its quota is available |
| 3 | `opencode` / GLM | when its quota is available |
| 4 | `opencode` / local Qwen | last resort, only for qualified task profiles with enforced tool restrictions (see R43) |

If none is available, HOLD the task or do it in MAIN. Never fall back to GPT, Codex or Claude.
A separate MAIN/subagent pool restriction is not exposed by the inspected T3 capabilities.
Use manual explicit selection: check the target before dispatch and the returned
`providerInstanceId`/`model` after; cancel any forbidden one.
Auto-dispatch and hybrid failover stay off.

- Coding subagents use `isolation: "worktree"`.
- A model that reports quota exhaustion is HOLD: report it, do not silently fail over to another
  model. No auto-dispatch or hybrid failover without an owner decision.
- Check the returned `providerInstanceId` and `model` of every delegated task.
- Production deploys and Firestore Rules deploys need owner release approval. CI and an
  independent review by an allowed subagent stays mandatory; if none is available, report the review as
  BLOCKED.

Rollback: re-enable `t3-delegation-guard.ts` in `pi config` (or delete that one `-extensions...`
entry from `settings.json`) and restart T3. Backups: `~/.pi/agent/backups/r60h-guard-retire-20261024/`.

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

## Owner Approval — R43 Local AI

Approved delegated model:
- ollama-proice/qwen2.5-7b-16k:latest

Provider Instance:
- opencode

Permitted:
- Read source code
- Analyze bugs and diffs
- Edit isolated synthetic fixtures
- Run Vitest
- Prepare bounded development patches

Restrictions:
- No Production writes
- No Firestore Rules deployments
- No credential modification
- No Guard bypass
- No automatic merge authority
- No independent security approval

MAIN remains Claude/GPT via Pi.

Local model requires successful task-specific tool-use qualification with enforceable
restrictions before being marked AGENT_READY. R62 does not reinstate a custom guard.
Until qualified, no unrestricted repository tools or independent security approval.

## Agent skills

Pstack remains the coordinator. Before using Matt Pocock skills, read
`docs/agents/skill-workflow.md` for routing, collision handling and delegation adaptation.
MAIN keeps the Owner-selected Pi model; skills do not select or change model routes.

### Issue tracker

GitHub Issues in this repository; see `docs/agents/issue-tracker.md`.

### Triage labels

Reuse existing labels and issue-body readiness states; see `docs/agents/triage-labels.md`.

### Domain docs

Single-context, lazy glossary/ADR creation; see `docs/agents/domain.md`.

Installation provenance and remaining activation gates: `docs/agents/matt-skills-installation.md`.
