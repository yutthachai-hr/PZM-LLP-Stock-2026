# Phase G: Agent Safety Foundation (G11–G16), evidence

Written 7 Oct 2026, on branch `claude/phase-a-ledger-continue-uzbbb5`. Design:
`docs/agent-safety/00-inspection-and-design.md`.

**Status: G11–G16 done. RC not frozen, nothing merged or deployed, and no H item started.**

## What each step delivered

| Step | Delivered | Proof |
|---|---|---|
| **G11** ActionProposal | `src/agent/proposal.ts`: schema `action-proposal/1`, strict parse, canonical JSON, FNV-1a-64 tamper hash, `untrusted[]`, `unresolved[]`, forbidden action types | `tests/agent-proposal.test.ts` (40 tests, including published FNV vectors). `tests/agent-no-write-path.test.ts` follows imports transitively and finds no backend, services, data, commands, Firebase, package or network path. |
| **G12** Business Guard | `src/agent/guard.ts` and `snapshot.ts`: about 25 rules with stable ruleIds; ALLOW, DENY or NEEDS_HUMAN; `combine()` can only tighten. It reuses the app's own period lock, unit rates and transfer floor. | `tests/agent-guard.test.ts`. Injected text changes no decision. A race is judged with `afterAccepting()`. |
| **G13** Rust integrity | `crates/pzm-integrity` (serde only): ten `INV.*` invariants. The TS reference is `src/agent/integrityReference.ts`. | 57 generated vectors; `cargo test` matches every one, and the check was mutation-tested. 60k movements: same report from both; Rust warm p50 ≈ 111 ms vs TS ≈ 102 ms; CLI cold ≈ 176 ms; peak ≈ 42 MB (`docs/evidence/data/integrity-bench.json`). **Rust is not faster here.** Its value is a second, independent implementation. |
| **G14** Workflow | `npm run verify` (`--full` adds the build and the bundle budget). `docs/engineering/pstack-workflow.md`. | All 13 gates pass on this machine. pstack itself was never supplied and is not imitated. |
| **G15** Dataset | `datasets/agent-safety/v1/scenarios.jsonl`: 377 rows (150 SAFE / 167 UNSAFE / 60 AMBIGUOUS). Seeded, labelled by how each row was built, pinned by sha256. | The freshness gate. The bench shows it can catch broken guards: allow-all, no floor, or reading text. |
| **G16** Attacks | `attacks.jsonl`: 68 rows. Prompt, OCR, supplier and model text injection; wrong record; stale; replay; tampered; cross-site; race; malicious parameters. | Injection invariance: 24 / 24 identical with and without the text. |

## Benchmark, deterministic guard (arm A)

| Metric | Result |
|---|---|
| unsafe-allow (primary) | **0 / 227** |
| false reject on SAFE | 0 / 158 |
| correct abstain on AMBIGUOUS | 60 / 60 |
| expected rule hit | 445 / 445 |
| wrong-record detected | 18 / 18 |
| p50 / p95 per proposal | ≈ 0.1 ms / 0.2 ms |

**This is synthetic, and written together with the guard.** It proves the rules do what they
say. It does not prove they cover real operations. Real cases from the owner belong in v2.

**Bugs the benchmark found while it was being built (all in the generator, not the guard):**
- a "tamper" that changed nothing;
- an unknown product that failed the shape check before reaching its rule.

The generator now refuses a no-op tamper.

## Also on this branch (owner briefs of 7 Oct)

- **G17 (Laya):** the harness is built; Laya is not yet supplied. The verdict is
  **NOT EVALUATED**. See `docs/evidence/phase-g17-laya.md`.
- **G18–G27:** an audit and a plan only, waiting for approval. See
  `docs/agent-safety/01-g18-g27-audit-and-plan.md`.
- **Receiving: smart supplier resolution:** see `docs/evidence/supplier-resolution.md`.

## Owner decisions now open

1. **Freeze the RC** at the current head. Gates are green; the emulator gates must be re-run in
   the cloud container first.
2. **Laya, KatGPT-rs, Reflex/Jev and pstack:** supply them, or say where to get them.
3. **G18–G27 first batch** (G25 + G18-lite + G21 property tests), and whether to merge
   `feat/outbox` first.
4. **A shared supplier-override collection** (a rules change).
