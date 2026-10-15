# Preflight evidence

Recorded on 2026-10-15 UTC. Directory names retain the initial 20261014 mission label.

## Repository

Fetched origin with pruning. Main has not changed from the owner's last inspected `af0136b0f6886989bc32d651a384ac05b39cdad6`. The root checkout is older at `b6bb206ca0d5282c84d8d7d2ab18059505019e10` and has an untracked `fixes/` folder. Neither was changed.

Created clean sibling worktrees for coordinator, A, B, and C. C starts from `exp/real-stack` at `7c78201c5df6b087177b8b18e5bb131e06b8ef9b`. The integration branch remains `0261c4887cce8f64bb2d60b4ef960454891f4227`. Neither experimental branch is a safe wholesale merge candidate.

Read AGENTS.md, all 492 lines of HANDOFF.md across bounded reads, README.md, SECURITY-NOTES.md, main CI, package scripts, experimental ADR-002, real-stack report, upstream verification, and owner gates. Worker briefs require their relevant remaining documents and CI.

The HANDOFF and README contain historical deployment instructions, not present approval to execute them. No Firebase deployment, live login, cron activation, data migration, or production data operation was performed.

## Baseline at af0136b

Executed in the coordinator worktree with Node v24.18.0 after a successful `npm ci`.

| Command | Exit | Result |
|---|---|---|
| `npm test -- --maxWorkers=2` | 0 | 109 files, 1326 tests passed |
| `npm run lint` | 0 | Passed |
| `npm run i18n:check` | 0 | Passed |
| `npm run build` | 0 | App, functions, worker, E2E typechecks and Vite build passed |
| `npm run check:bundle` | 1 | Default RC target failed, 900 KB main and 2048 KB total |
| `BUNDLE_MAIN_KB=2950 BUNDLE_TOTAL_KB=3450 npm run check:bundle` | 0 | Actual main CI no-regression budget passed |

Do not erase the default-budget failure. The checked-in script distinguishes the RC target from main's existing CI budget. PR #16 aims to reduce the bundle. The build output is not proof of offline PWA or export behavior.

Rules and E2E reruns are assigned to A, which exclusively owns default emulator ports. They have not been run by the coordinator. Logs are in `C:/Users/Yutthachai/pzm-mission-runtime-20261014/` as `main-*.log` and `control-npm-ci.log`.

## Release state

PR #17 is a draft at `f3f833e131d2d8ce42740e61560c65516ed9b899`. Discovery found all nine GitHub CI checks and Cloudflare Pages successful, merge state CLEAN, and no submitted review. This is not merge authorization until independent exact-SHA review and safe Preview QA pass. Receipt is `pr17-preflight.json` in the runtime folder.

PR #19 remains open at `9c1e27e08660c108471edce7d67f7225a918ad37`. PR #16 remains open at `fe989690e74f549cd6fdd4529c3d7e3b2350f665`. PR #1 remains open at `4898dbbf66a8a5a2c6e3e52e724824074b4c5ed6`. PR #18 and #2 through #15 are already merged. Existing functionality must not be rebuilt.

Main protection requires strict final-head checks for agent-safety, build-budget, e2e, lint-i18n, secrets, rules, rust, typecheck, and unit. Conversation resolution and admin enforcement are on. Force pushes are off. GitHub requires zero approval count, but the owner's independent review requirement still applies. Receipt is `main-protection.json`.

## Existing implementations

The real-stack report describes an existing read-only Ask PZM pipeline, deterministic guard, transport-injected clients, synthetic snapshots, Laya Python and native Rust lanes, Reflex modelless lane using KatGPT-rs decision_wire, pinned weights, safety fixtures, Rust integrity crate, and benchmarks. Its measurements are historical and synthetic, not refreshed evidence. C owns the fresh inventory and independent benchmark. The 126 synthetic examples are not independent validation.

The existing Security Prototype is in `pzm-security-s1` at `b772f7cce5e885878d79e4266702ecd7ad467db8` and the later `pzm-security-20261014` at `d3d0d0337b99c7375aa81b2cd3419f31d8e9c6e1`. Its files include `functions/_lib/stockCommandProto.ts`, `tests/stock-command-proto.test.ts`, and `e2e/s1-audit-repro.mjs`. The latest commit adds an explicit transfer-brand check before route lookup. These existing worktrees are not modified or promoted.

Prior owner gates remain unresolved evidence, including old production-connected previews, a cron placeholder investigation, and the October read spike. Nothing in the mission overrides those facts or grants destructive cleanup.

## Superpowers

Inspected official source at `bb92a77741419a4ab5f06e711a283343f1ada0c3`, version 7.0.0, in the runtime folder. Read package manifest and both runtime bootstraps before enabling any plugin.

Pi has no configured Superpowers package. The official `pi install git:github.com/obra/superpowers` attempt was denied by the owner-managed delegation guard. No alternative shell invocation or manual settings edit was attempted. Owner-side installation is required. Native Pi availability and genuine post-Compact bootstrap remain BLOCKED.

The upstream Pi source tests passed 6/6, including simulated post-compaction injection. That proves only those source tests, not installation or a real Compact event. Receipt is `pi-source-tests.log`.

OpenCode is v2.0.29. Its actual configuration source is `C:/Users/Yutthachai/.config/opencode/opencode.jsonc`. Added the official package string to the V2 `plugins` array, preserving provider and model settings. Existing default, small model, and all named agents remain pinned to approved Gemini high. T3 provider configuration selects binary `opencode` with no custom server URL.

The OpenCode server log shows the official plugin loaded from its git-backed package cache. API metadata later lists plugin id `superpowers` and all five required skills, alongside Pstack. Receipts are `opencode-project-plugins.json` and `opencode-project-skills.json`. The API response location is the home directory, so it is not by itself proof of a particular child session's skill tools. Each child must supply native load and real-workflow evidence.

Initial OpenCode CLI API attempts failed because Git Bash converted `/api/...` into a Windows filesystem path. `MSYS_NO_PATHCONV=1` preserves the documented API path. This is argument correction, not a guard bypass. Direct unauthenticated HTTP probes returned Unauthorized; no authentication was weakened. The documented CLI performed authenticated reads. No active runtime was restarted.

## Runtime reliability

Live capabilities confirm opencode with approved high and medium model IDs. Three parent-owned async tasks were accepted with explicit high targets. No nested tasks or alternate provider was requested.

Current parent runtime is Pi with `openai-codex-account-2/gpt-6.1-sol`, as reported by T3 capabilities, despite older policy prose naming Pi plus Claude. No provider or model reconfiguration was attempted.

The real OpenCode config points at 9Router on `http://localhost:20128/v1`, mapping high and medium to their approved upstream IDs. Credentials are not reproduced. Existing account selection/fallback has not yet been verified. No rate-limit workaround or credential change is authorized.

A separate T3 source worktree exists at `C:/Users/Yutthachai/t3-main-rollover-20261014`, clean at `cddbf8bdb5b38f7678e5e9d0046bade4051a192d`. It was identified, not changed. No genuine automatic new-thread handoff has been observed. Auto Thread Rollover is UNVERIFIED and distinct from Pi Compact. Guard-blocked fork/configure tools are not used to simulate it.

## Skill evidence

All paths below were loaded in this session. Source-only Superpowers workflow use is not native Pi installation.

- `C:/Users/Yutthachai/pzm-mission-runtime-20261014/superpowers/skills/using-superpowers/SKILL.md` and its Pi mapping. Applied task routing; native subagents excluded by explicit owner policy.
- `.../dispatching-parallel-agents/SKILL.md`. Partitioned three independent scopes, wrote self-contained prompts, launched all three together. Aggregate and integration steps are pending results.
- `.../brainstorming/SKILL.md` and `.../writing-plans/SKILL.md`. Reviewed supplied goals, constraints, and execution method. Additional approval loops skipped under the user's explicit execution directive. Concrete per-stream plans are delegated; no product code was written by coordinator.
- `.../using-git-worktrees/SKILL.md`. Worktree inventory, exact refs and clean isolated siblings established. Read occurred after creation, so the creation itself is not claimed as skill-driven. Setup and baseline verification were executed after loading.
- `.../verification-before-completion/SKILL.md`. Ran full baseline commands, read actual outputs, retained failures, and withheld merge/installation claims.
- `C:/Users/Yutthachai/.agents/skills/swarm/SKILL.md`. Framed three coverage slices with exclusive writes and exact SHAs, then fanned out through approved T3 tools. Aggregation/report completion pending.
- `C:/Users/Yutthachai/.agents/skills/show-me-your-work/SKILL.md`. Created canonical append-only decision trail. Transcript audit and independent trail review pending. No final review claim.
- `C:/Users/Yutthachai/.agents/skills/poteto-mode/SKILL.md` and `playbooks/orchestrate.md`. Coordinator does discovery, briefs, tracking and verification rather than product implementation. The skill's bespoke orch CLI was not initialized; plain Markdown/TSV tracking is used for this three-task first wave. Pilot serialization was skipped because the user explicitly requested three initial streams. Full program completion is not claimed.
- `C:/Users/Yutthachai/.agents/skills/technical-writing/SKILL.md`. Used reference-style evidence records, exact names and command outcomes. The separate unslop leaf has not been loaded, so full composite compliance is not claimed.
- `C:/Users/Yutthachai/.agents/skills/principle-prove-it-works/SKILL.md`. Chose actual registry/API and test receipts over installation assumptions. No completed code task is claimed.
