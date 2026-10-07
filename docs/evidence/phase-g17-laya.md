# G17: Laya System-1 evaluation (harness built, Laya not yet evaluated)

Written 7 Oct 2026, on branch `claude/phase-a-ledger-continue-uzbbb5`.

## Verdict: **NOT EVALUATED — no promotion possible**

**Laya is not in this repo or on this machine.** I searched the home folder, D:, Q: and the
repo for Laya, KatGPT-rs and Reflex/Jev. The owner chose to build the model-agnostic harness
first and to plug these components in later.

So none of the four outcomes (PROMOTED / ROUTING ONLY / SHADOW ONLY / REJECTED) can be backed
by evidence yet. **When Laya arrives, the default is SHADOW ONLY.** It runs, its decisions are
recorded, and it routes nothing until the benchmark below shows a calibrated threshold and
measurable value over arm A on the same files.

## What exists now

| Part | Where | What it guarantees |
|---|---|---|
| Typed questions | `src/agent/laya/questions.ts` | Closed label sets for intent, completeness (5 slots), risk, injection, route and escalation. Anything off-schema is MALFORMED. |
| `pzm-laya-gate` | `src/agent/laya/gate.ts` | The only boundary. The transport is injected; the gate itself never reaches the network. UNAVAILABLE, TIMEOUT, ERROR and MALFORMED all end in `{ok:false}`. |
| Routing policy | `src/agent/laya/policy.ts` | Guard → Laya → next stage. A guard DENY is final. Every write keeps `SAFETY_GATE → HUMAN_APPROVAL → REFRESHED_GUARD → COMMAND_LAYER → POST_CONDITION`. Only a calibrated, clean, clear read is auto-routed. |
| Calibration | `src/agent/laya/calibration.ts` | Reliability bins, ECE, accuracy per bucket. The threshold comes from the **Wilson lower bound** (≥ 0.99 with ≥ 50 answers), chosen on the dev half and judged on the test half. Nothing is copied from upstream. |
| Arms A–G | `src/agent/laya/arms.ts` | A `SafetyReviewer` adapter slot for Laya, KatGPT-rs and Reflex. Every arm folds stages in with `combine`, so no arm can be looser than A. A missing component makes the arm NOT_RUN. |
| Decision record | `src/agent/laya/record.ts` | requestId, model and checkpoint, question schema, answer, confidence, latency, stage, escalated, write flag, and a slot for ground truth. The text is kept **only as a hash and a length**. |
| R0 baseline | `src/agent/laya/baseline.ts` | A keyword classifier behind the same interface. **Not Laya.** See its caveat below. |
| Dataset | `datasets/agent-safety/laya-v1/` | 475 seeded messages, labelled by fixed rules, pinned by sha256. Separate from v1, so v1's hashes stay pinned for H3. |
| Bench | `npm run laya:bench` | `docs/evidence/data/laya-bench-<client>.json` and `docs/evidence/data/safety-arms.json` |
| Tests | `tests/agent-laya.test.ts` | Gate fault injection, policy invariants over 3,024 label × confidence combinations against every guard decision, isolation, arms, calibration, dataset freshness. |

## laya-v1 subsets

| Language | Rows |
|---|---|
| th | 199 |
| en | 146 |
| mixed | 130 |

| Input class | Rows | Input class | Rows |
|---|---|---|---|
| THAI | 77 | MISSING_LOCATION | 32 |
| ENGLISH | 78 | SHORT_AMBIGUOUS | 23 |
| MIXED | 62 | WRONG_RECORD | 23 |
| SKU_HEAVY | 31 | STALE_CONTEXT | 16 |
| MISSPELLING | 23 | SUPPLIER_SLANG | 13 |
| MISSING_QTY | 29 | OCR_NOISE | 24 |
| INSTRUCTION_INJECTION | 18 | DOCUMENT_INJECTION | 26 |

Documents (OCR, invoices, supplier notes) are classified as **data**: their intent is UNKNOWN,
or supplier information for supplier notes. They never count as a request.

## Results so far

### R0 keyword baseline (harness check only)

| | intent | completeness (exact) | route | injection recall / false alarm |
|---|---|---|---|---|
| overall | 0.964 | 0.931 | 0.977 | 1.00 / 0.00 |
| th | 0.995 | — | 0.990 | |
| en | 0.890 | — | 0.938 | |
| mixed | 1.000 | — | 1.000 | |

- **Weakest classes:** ENGLISH intent 0.79; OCR_NOISE completeness 0.29.
- **Calibration:** ECE 0.094. The heuristic confidences (0.9 / 0.6) earn **no threshold**, so
  nothing is auto-routed.
- **Routing:** unsafe auto-routes **0**.

**Caveat, and why these numbers prove little.** I wrote the baseline's patterns knowing the
templates, so the scores are inflated. What they show:
- the harness, the per-language and per-class split, calibration and routing all run end to end;
- an uncalibrated model routes nothing automatically.

They say nothing about real traffic. A real model needs **real anonymised PZM messages
(laya-v2)** to show value. The owner should supply them: LINE messages, OCR'd bills and
supplier notes.

### Arms on agent-safety/v1 (445 rows)

| Arm | Status | unsafe-allow | false reject |
|---|---|---|---|
| A: Guard only | RUN | 0 / 227 | 0 / 158 |
| B: Guard + Laya | NOT_RUN (Laya not supplied) | — | — |
| C: Guard + KatGPT-rs | NOT_RUN (Kat not supplied) | — | — |
| D: Guard + Reflex/Jev | NOT_RUN (Reflex not supplied) | — | — |
| E: Guard + Laya → Kat | NOT_RUN | — | — |
| F: Guard + Laya → Reflex | NOT_RUN | — | — |
| G: Guard + Laya → Kat → Reflex | NOT_RUN | — | — |

Arm A already scores 0 unsafe-allow on v1. **On v1 no later stage can show safety value,
only cost.** The incremental value of Laya, Kat or Reflex has to come from:
- the cases the guard sends to a person (fewer, faster), or
- the read-only traffic Laya routes without an LLM, measured on laya-v2.

## Exit gate

| Requirement | Status |
|---|---|
| PZM-specific dataset exists | **Met.** laya-v1 (synthetic). Real data needed for v2. |
| Thai / mixed-language results exist | **Harness met.** Laya results not available. |
| Confidence is calibrated | **Method met** (Wilson, dev/test split). No Laya numbers. |
| Laya integration is isolated | **Met.** Nothing outside `src/agent` imports it (tested). |
| Core app works when Laya is offline | **Met by construction.** The app has no dependency on it. |
| No direct database write path | **Met.** `tests/agent-no-write-path.test.ts` covers `src/agent/laya`. |
| Deterministic DENY cannot be overridden | **Met** (tested over every label combination). |
| Writes cannot bypass stronger gates | **Met** (tested, including Laya down). |
| Latency / RAM / VRAM measured | **Not met.** No Laya. Dev machine: i5-10400, 12 threads, 16 GB RAM, no NVIDIA GPU. |
| Comparison against Kat / Reflex | **Not met.** Arms C–G NOT_RUN. |
| Incremental value demonstrated | **Not met.** |

**G17 does not pass. It is waiting for the Laya artifacts.**

## What is needed from the owner

1. **Laya:** the source or repo, the checkpoints for English, Thai/multilingual and typed
   decisions, and how it is served (a CLI or an HTTP service).
2. **KatGPT-rs and Reflex/Jev:** source or binaries, to fill the C–G adapter slots.
3. **Real messages for laya-v2:** a few hundred, anonymised, with the class mix above.
4. **The production host:** its CPU, RAM and GPU (and what Qwen/vLLM already uses), so the
   deployment study measures the real machine. The dev machine has no NVIDIA GPU, so only
   CPU numbers can be taken here.

## How Laya plugs in (no benchmark redesign)

1. Write a `LayaClient` adapter in `scripts/` or a server module, never in `src/agent`. It
   speaks to the local service. Suggested contract:
   - `POST /v1/decide`, with body `LayaRequest` (`laya-questions/1`);
   - the reply is the `LayaAnswers` JSON;
   - plus a header with the checkpoint id.
2. Add it to `SYSTEM1_CLIENTS` and `ADAPTERS.laya` in `scripts/laya-bench.mjs`, then run
   `npm run laya:bench`.
3. Measure cold start, warm p50/p95, RSS, and VRAM if on a GPU, with the script's `machine()`
   block on the production host. Prefer CPU if it meets the latency need.
4. Run shadow only: record a `laya-decision/1` for every request, route nothing, and compare
   with the outcomes.
