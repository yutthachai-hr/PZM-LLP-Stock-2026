# Default Claude bridge failover repair

Candidate only. Nothing in the live Pi or T3 installation was changed.

## Incident and cause

The PZM main session started on `claude-bridge/claude-opus-5-5`. Its transcript contains five five-hour quota failures. The installed rotator only handles explicit `claude-bridge-account-1/2` and `openai-codex-account-2/gpt-6.1-sol`, so it ignored the default bridge. The later model-change entry at 08:14:31Z selects Codex, but coincides with the owner's next prompt; it does not prove automatic failover.

The generic bridge inherits `CLAUDE_CONFIG_DIR` or uses `~/.claude`. Account 1 is configured for `~/.claude`. This candidate adds one opt-in source alias, validated against that effective profile. It never adds destinations or treats arbitrary Claude providers as equivalent.

## Scope

- `src/index.ts`: preserved rotator plus source-alias validation and canonical quota bookkeeping. Original-route equality still rejects stale failures after manual selection.
- `tests/scenarios.mjs`, `tests/run.mjs`: isolated callback-level scenarios with fake credentials and stubbed usage endpoints. No inference, tools, server, or external writes.
- `tests/legacy.mjs`: runs the prior local 34-case harness against this source without overwriting its evidence. It depends on the preserved `pzm-release-tools` harness on this machine.
- `evidence/`: RED/GREEN, legacy, and strict typecheck output.

Run from this directory:

```sh
node tests/run.mjs
node tests/legacy.mjs
../PZM-LLP-Stock-2026/node_modules/.bin/tsc -p tsconfig.json
```

Baseline: 5/12 pass, seven failures on the default bridge. Candidate: 14/14 pass; prior suite: 34/34 pass; strict typecheck: exit 0. Test hosts and usage responses are simulated. These are not live T3 handoff tests.

## Opt-in setting (not installed)

Preserve the existing `routes` and other fields in `~/.pi/agent/account-rotation.json`, adding only:

```json
{
  "sourceAliases": {
    "claude-bridge/claude-opus-5-5": "claude-bridge-account-1/claude-opus-5-5"
  }
}
```

If the actual inherited profile does not match account 1's configured usage profile, the alias is ignored. With this setting absent, default-bridge behavior is unchanged.

## Acceptance and activation blockers

1. Independent OpenCode review must cover the exact source commit.
2. Installed T3 native usage-limit recovery only resumes after reset; it has no cross-provider routing policy. Pi handles inference-provider changes within the same session here; the T3 harness remains `pi`.
3. A previous isolated T3 patch (`cddbf8bdb5`, `t3-main-rollover-20261014`) fixes native-model synchronization and handoff compaction but has not been activated in the installed runtime. Verify it before claiming T3 selection stays synchronized or that later turns will not restore a stale primary.
4. Guard policy blocks `t3_thread_configure` and non-OpenCode `t3_thread_launch`. No agent-side API workaround, raw transport, shell-launched agent, or policy edit is permitted. A new-main-thread strategy would need a narrowly scoped owner-managed exception.
5. Do not restart T3 while children or state-changing work are active. At an idle owner-approved checkpoint, back up extension and configuration, install the independently reviewed candidate through the normal local-extension mechanism and reload only the main agent session using supported UI controls. Confirm a new `session_start` log has build `default-bridge-alias-v1` and the expected source alias.
6. Live acceptance still needs a controlled simulated quota event through a supported test seam, followed by actual Codex inference and one read-only tool call, with the same thread/session and no repeated operations. No such live seam was invoked or real subscriptions exhausted here.
7. The existing rotator persists cooldown/breaker state, but pending continuation is in-memory. The restart test proves canonical cooldown preservation, not durable exactly-once continuation if the app crashes after selection and before reconciliation. This remains a separate release blocker for the owner's full restart acceptance.

## Test A-J coverage

| Case | Evidence | Limit |
|---|---|---|
| A healthy Claude | healthy-stays | callback test |
| B account 2 available | default-to-account2 | fake headroom |
| C both Claude full, Codex available | default-to-codex | fake headroom, no inference |
| D all full | all-full-stops | one abort, no continuation |
| E recovered primary does not displace healthy Codex | no-oscillation-after-reset | T3 host sync not live-verified |
| F uncertain tool result | uncertain-actions-not-replayed | keeps result and injects reconciliation instruction; no actual Git/Firestore action |
| G child survival | no child-start/cancel API in candidate | no live failover test |
| H traceability | source alias log and appendEntry | same session, no new thread |
| I restart | restart-honors-canonical-mark | cooldown only; pending continuation durability unresolved |
| J Mission Control | runtime-failover-20261015.md and active-tasks.json | live switch not claimed |

## Rollback

The live extension remains SHA-256 `6effacf40a21c2a588d75157e327c51bf6d89805d2555057e00f4aae93617888`. Its unmodified bytes are preserved in baseline commit `f1d0ef6` of this repo. If a later activation fails, restore the backed-up extension and configuration at an idle checkpoint and reload the main session through supported UI controls. Remove only `sourceAliases` to disable default-bridge handling without altering existing account routing. Never reset shared quota state or edit OAuth credentials as part of rollback.
