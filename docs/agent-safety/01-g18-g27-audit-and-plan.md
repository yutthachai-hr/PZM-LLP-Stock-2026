# G18–G27: audit of what exists, and a plan (nothing implemented yet; waiting for owner approval)

Audited 7 Oct 2026 on branch `claude/phase-a-ledger-continue-uzbbb5` at `b8eabb7`. Also
checked: the `feat/outbox` branch in the main checkout.

**One fact shapes everything below.** The outbox and the Supabase shadow replica exist (commits
`cf977aa`, `15b428e` and `a2f1c70` on `feat/outbox`), but they are **not merged** into this
branch. G18 (propagation through the outbox), G23 (Postgres search) and G26 (restore drills to
Supabase) depend on that merge. Deciding merge order is the owner's call.

## 1. What already exists (per item)

| Item | Exists today | Where |
|---|---|---|
| **G18** Correlation | `operationId` on stock commands (idempotency, `receiptIdFor`) and on audit entries. `requestId` only on supplier confirmations (`isReplay`). **No `traceId` anywhere.** E4 client-error logs to Workers logs. G17 `laya-decision/1` records carry a requestId. | `src/commands/stockCommands.ts`, `src/services/auditLog.ts`, `src/lib/supplierConfirmation.ts`, `functions/api/client-error.ts` |
| **G19** State machines | **PR:** one lifecycle module. **Transfer:** one lifecycle and actor table, mirrored by the rules' `transferMove()`. **PO, receiving, count:** status checks spread across services and commands. There are 147 `status ===/!==` comparisons in components and pages; some are display, some are logic. | `src/lib/purchaseRequestStatus.ts`, `src/lib/transferStatus.ts`, `firestore.rules` |
| **G20** Policy | Firestore rules (authoritative). `CommandSpec.roles` per command. `inventoryRules/permissions.ts` (task actions). Over-receipt tolerance per role (plan B5). G12 `ACTION_ROLES` for agent proposals. **No single policy module.** | `firestore.rules`, `src/commands/spec.ts`, `src/lib/inventoryRules/permissions.ts`, `src/agent/guard.ts` |
| **G21** Verification | Differential TS↔Rust on 57 shared vectors, which fails on any difference (G13; mutation-checked by hand). Seeded datasets. Flaky-run loop. **No property-based or mutation testing tool.** | `crates/pzm-integrity`, `tests/agent-*.test.ts` |
| **G22** Resilience | `operationId` idempotency on receipts. `retryLive` and the live-error bar. The offline indicator `useOnline`. The OCR endpoint is read-only. **No fault-injection suite, no circuit breaker.** The G17 gate fails safe, but only for Laya. | `src/data/*`, `src/lib/useOnline.ts`, `src/agent/laya/gate.ts` |
| **G23** Search | `foldSearch` (fold, then every word in any order). `productMatch` (exact, confirmed alias, otherwise candidates; "a guess is never an answer"). `productAliases` collection. **No trigram, FTS or vectors. No Postgres search in this branch.** | `src/lib/search.ts`, `src/lib/productMatch.ts` |
| **G24** Registry | `IntelMeta` (engine, version). Gemini model selection. G17 `ModelInfo` and decision record. **No registry and no routing telemetry.** | `src/intel/meta.ts`, `tests/gemini-model.test.ts`, `src/agent/laya/*` |
| **G25** Freshness | `ActionProposal.inputsAsOf` and `G.STATE.FRESH` (G12). Transfer `expectedRevision`. PR `revision`. Period lock. **No entity version on PO or product; no version check before AI execution (none exists yet).** Contract versions: `action-proposal/1`, `pzm-integrity/1`, `laya-questions/1`, `laya-decision/1`. Not yet: SafetyDecision, OutboxEvent (on its branch), PredictionSnapshot, AuditEvent. | `src/agent/*`, `src/commands/transferCommands.ts` |
| **G26** Replay / DR | Immutable ledger. `balancesFromLedger`. Integrity audit (app and `npm run audit:integrity`). The Rust verifier (G13). Backup download. `backfill:po-baseqty` dry-run on backups. **No "explain this balance" tool, no restore drill.** | `src/lib/levelKey.ts`, `src/lib/integrityAudit.ts`, `scripts/integrity-audit.mjs` |
| **G27** Simulation | Pure intel engines: stock-out `simulate()`, transfer candidates, purchase, backtest with synthetic history. **No scenario API, no "what if".** | `src/intel/stockout.ts`, `src/intel/backtest.ts` |

## 2. Gaps (the shortest list that matters)

1. **No traceId.** You cannot follow one request from the screen to the API, the
   transaction, the outbox, the Worker and the notification.
2. **PO, receiving and count have no central transition table.** Invalid transitions are
   stopped by scattered checks and by the rules.
3. **No version check on PO or product.** An AI or stale-tab edit could overwrite a newer
   change. Transfers already have `expectedRevision`.
4. **No property, mutation or fault-injection testing.**
5. **No circuit breakers** for OCR or Gemini. Each call simply fails or times out.
6. **No model registry**; versions are scattered across `IntelMeta`, Gemini config and G17.
7. **No restore drill.** Backup exists; proof that it restores and verifies does not.

## 3. Overlap with work already done

- **G21 differential testing is mostly done** by G13. What remains: property tests, and
  mutation testing pre-release.
- **G25 freshness for proposals is done** (`G.STATE.FRESH`). What remains: entity versions and
  the execution-time re-check, which is H6 territory.
- **G19 for PR and transfer is done.** Copy their pattern for PO, receiving and count, rather
  than introducing a framework.
- **G24 overlaps G17's `ModelInfo` and `laya-decision/1`.** The registry is a table of those, not
  a new system.
- **G26 "explain a balance"** is `balancesFromLedger` plus the movement list.
- **G27 is mostly `simulate()`** run with changed inputs.

## 4. Recommended order

| # | Item | Why now |
|---|---|---|
| **1** | **G25 Freshness + versions** | Highest risk reduced per line of code. It blocks stale overwrites from people *and* future AI, and Phase H execution needs it first. |
| **2** | **G18 Correlation (lite)** | Cheap plumbing that every later item (G22, G24, G26) uses to show evidence. |
| **3** | **G21 Property tests** | Proves G25 and the ledger invariants on generated inputs. Mutation testing is a pre-release script. |
| 4 | G19 State machines (PO, receiving, count) | The pattern exists; it moves logic out of screens. |
| 5 | G20 Policy module | Easier after G19, because policies hang off transitions. |
| 6 | G22 Chaos / circuit breakers | Needs G18 to observe and G19/G20 to define "safe". |
| 7 | G26 Replay / restore drill | Needs the outbox merged; uses G13. |
| 8 | G24 Registry + routing telemetry | Matters once a second real model exists (Laya, Kat). |
| 9 | G23 Search on Postgres | Needs the Supabase track merged; `productMatch` covers today's need. |
| 10 | G27 Simulation | Design only, as asked. Wraps `simulate()`. |

## 5–9. Per item: complexity, runtime impact, dependencies, files, tests, exit gate

| Item | Complexity | Runtime impact | Operational dependencies | Files / modules | New tests | Exit gate (measurable) |
|---|---|---|---|---|---|---|
| **G25** | M | +1 field read in transactions that already read the doc. **0 extra Firestore reads.** | Rules change for `version` on PO and product (owner approval: rules) | `src/types.ts`, `src/commands/*`, `src/services/purchaseOrders.ts`, `firestore.rules`, `src/agent/contracts.ts` (new: schema registry and fail-safe parse) | stale write rejected (app + rules emulator); unsupported schema version refused; proposal executed against a newer version → DENY | Any write with an old `expectedVersion` fails in the rules emulator; read benchmark unchanged |
| **G18** | S–M | One header and one field per write. No extra reads. | Workers log retention | `src/lib/trace.ts` (new), `src/services/stock.ts`, `functions/api/stock/[command].ts`, `worker/src/*`, `src/services/auditLog.ts`, outbox (after merge) | the same traceId appears on the movement, audit entry, outbox event and notification for one receive | One e2e receive can be reconstructed from its traceId alone; no payload fields in logs (tested) |
| **G21** | S (props) / M (mutation) | None (CI only) | adds `fast-check` (dev only); Stryker for pre-release | `tests/prop-*.test.ts`, `crates/pzm-integrity/tests/prop.rs` (hand-rolled generator; keeps the crate serde-only), `scripts/mutation.mjs` | ledger: balance = Σ movements under any order of valid ops; guard: monotone (adding a defect never turns DENY into ALLOW) | ≥ 10k generated cases per property green; mutation score recorded per release |
| G19 | M | None | none | `src/lib/poStatus.ts`, `receivingStatus.ts`, `countStatus.ts` (new, PR/transfer pattern); callers in services and pages | every (state, action, role) cell tested against the rules | 0 status-transition literals left in pages for these 3 workflows |
| G20 | M | None | none | `src/lib/policy.ts` (new) wrapping roles + tolerances + G12 `ACTION_ROLES` | table tests per policy; rules stay authoritative | each named policy returns ALLOW / DENY / REQUIRES_APPROVAL from one place |
| G22 | M–L | Breaker state in memory only | emulator for the fault suite | `src/lib/breaker.ts` (new), OCR and Gemini callers, `e2e/chaos-*.spec.ts` | the 12 failure scenarios listed by the owner | stock correctness (G13 verifier) PASS after every scenario; manual receive works with OCR and AI down |
| G26 | M | None | **outbox merged**; an isolated Firebase project or Supabase for drills | `scripts/restore-drill.mjs`, `scripts/explain-balance.mjs` | the drill restores a backup, then the Rust verifier must return PASS | quarterly drill log in `docs/evidence/dr/`; RTO measured |
| G24 | S | None | none | `src/agent/registry.ts` (new): id, version, artifact hash, role, enabled, introducedAt, retiredAt, benchmarkVersion | every decision record references a registry entry | no AI output without a registry id (tested) |
| G23 | M–L | Postgres-side only | **Supabase track merged**; `pg_trgm` extension | `supabase/` SQL, a search RPC, a benchmark script | Recall@1/3/5, latency, false auto-match on a labelled alias set | false auto-match = 0 at the chosen cut; candidates always real product ids |
| G27 | S (design) | None | none | `docs/agent-safety/g27-simulation.md` (design only) | none yet | design reviewed by owner |

**Deliberately not proposed:** Kubernetes, Kafka, Redis, microservices, full event sourcing,
a separate vector database, or a feature store. Nothing measured so far needs them; reads are
about 24k a day after Phase G.

## Recommended first batch (smallest high-impact)

**G25 + G18-lite + G21 property tests.** Roughly three focused days of work. Zero extra
Firestore reads. One rules change (an entity `version` on PO and product), which needs the
owner's approval under rule 7.

It gives:
- no stale overwrite, whether from a person or from an AI;
- one traceId per workflow;
- generated-input proof of the ledger and guard invariants.

**Waiting for the owner's approval before starting**, including a decision on merging
`feat/outbox` first.
