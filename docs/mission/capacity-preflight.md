# Child-agent capacity preflight, 2026-10-15

## Verdict

Safe concurrency right now is **zero productive children**. Both approved routes are in an upstream quota cooldown. Ramping from 3 to 8 children is deferred until the reset and then must pass the stability checks below. The earlier cap of 3 was project policy from the Owner's first brief. It was not a T3, OpenCode or delegation-guard limit.

## Evidence (read-only)

- T3 `orchestrator_capabilities`: opencode `canRunChildTask=true`, `maxBatchThreads=20`, no stated concurrent-child cap.
- Delegation guard `~/.pi/agent/extensions/t3-delegation-guard.ts`: validates provider and model only. No concurrency limit. Unchanged.
- OpenCode API `GET /api/session/{id}/message`: every recent child session has 0 input tokens, 0 output tokens, 0 tool calls and cost 0. Each session's assistant message carries a retry record:
  - `503 [antigravity/gemini-3.8-flash-high] Unavailable (reset after 3h 28m 36s)` at about 03:59:40Z.
  - `503 [antigravity/gemini-3.8-flash-medium] Unavailable (reset after 3h 32m 42s)` at about 03:55:35Z.
  - Both resolve to an upstream reset near **07:28Z**. OpenCode retries every 15 minutes; T3 shows these tasks as `working`.
- The OpenCode log shows only per-step snapshot git commands, no shell tool calls in any assigned worktree since about 03:15Z.
- 9Router `http://localhost:20128/v1/models`: HTTP 200, listening (pid 6376).
- 9Router database (read-only; token columns redacted): 2 active `antigravity` OAuth connections with priorities 1 and 2. 9Router's own rotation already spans both; the cooldown reply is after rotation. No account, credential or rate-limit setting was changed.
- Host: 12 logical CPUs. `nvidia-smi` is absent, so there is no local NVIDIA GPU. There is no shared GPU or Qwen GPU budget on this machine.

## Consequences

- The original A/B/C tasks did not hang because of prompt or brief size. They never received a model response. Their scope is still incomplete.
- Currently queued sessions: Orders PR20 review (medium), PR17 review (high), ThaiTrees continuation (high). Not interrupted, per Owner instruction. They should resume on their own after the reset.
- Another thread's session "PR17 independent R5 exact d37e414 filing scope" targets the same PR17 SHA as this thread's PR17 review. That is duplicate quota spend after the reset. Flagged to the Owner; neither was cancelled.
- Main-agent fallback per AGENTS.md: the coordinator does P0 work inline while children are blocked.

## Ramp plan after the reset

Step 3 → 4 → 6 → 8, waiting for at least one completed model turn per new child before the next step. Hold or step back on any of: a 429 or 503 cooldown reply, a child with no tokens after 10 minutes, a host memory or test-port contention problem, or duplicate assignment. Every child gets an isolated worktree and explicit file ownership. Emulator and E2E ports are serialized to one owner at a time. Concurrency is limited to the capacity actually observed, never a target number.
