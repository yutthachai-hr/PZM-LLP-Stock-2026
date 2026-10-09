# AI READ-ONLY PILOT: GO / NO-GO (9 Oct 2026)

**Branch:** `exp/real-stack`. Separate from the RC; never merged to `main` by this work.

## Verdicts

| Decision | Verdict |
|---|---|
| **Ask PZM (deterministic: guard + keyword router + read-only tools) in isolated staging** | **GO for staging**, deployment **BLOCKED**: no staging Firebase project or staging Pages project exists yet. Code and tests PASS. |
| **Model routing (Laya English or multilingual) inside Ask PZM** | **NO-GO.** On independent held-out data the guard misses most write requests, and a model then answers some of them as reads (7 unsafe with multilingual). Stays off: shadow measurement only. |
| **Reflex modelless** | **Shadow only** (19% on the PZM domain), per owner decision 7 |
| **AI Gateway** | Code **PASS** (tests); staging deploy **BLOCKED** (owner: tunnel, Access, host) |
| **Production exposure of any of it** | **NO-GO**: refused in code (`functions/api/ask.ts` serves only the staging tier) |

Passing tests are not authorisation to deploy.

## 1. Identity

| Item | Value |
|---|---|
| Commits | `exp/real-stack` `d105015` (stack), `d4ecb2b` (Ask PZM + gateway + held-out), this report |
| Laya | 0.4.0 (NandhaKishorM/laya `3cf26cb`), Python 3.14.6, torch 2.14.1+cpu, transformers 5.19.0, CPU only |
| English checkpoint | convaiinnovations/laya `7b928d8`, SHA-256 `891102d3…` (the owner's selection) |
| Multilingual checkpoint | same repo, `multilingual/`, `7b928d8`, SHA-256 `9d628fd9…`, tokenizer `609d8f4c…`. An **addition**, own process, port 7341. |
| Reflex | v0.2.4 release binary, SHA-256 `fc5a841b…` = SHA256SUMS. KatGPT-rs `ee28839` inside. |
| Host | i5-10400 (6 cores / 12 threads), 16 GB, **no GPU (VRAM N/A)**, Windows 11 |

## 2. Test results

| Suite | Result |
|---|---|
| Unit, whole repo (worktree) | **PASS**: 1,833 passed, 1 skipped |
| `tests/ask-pzm.test.ts`: pipeline, DENY never overridden, clients fail closed | **PASS** (23) |
| `tests/functions/ask.test.ts`: auth, revoked, rate limit, site scope, brand namespace, ids resolved, read caps, read-only store, nothing written, AI outage | **PASS** (19) |
| `tests/ai-gateway.test.ts`: Access JWT, shaping, limits, breaker, logs | **PASS** (9) |
| `tests/preview-isolation.test.ts`: `/api/ask` is behind the guard | **PASS** |
| Reflex endpoint validation (real process) | **PASS** 26/26 |
| Rust ↔ Python Laya parity (same checkpoint and inputs) | **PASS** 126/126 |
| Typecheck, lint, i18n, rules emulator, Rust | **PASS** |
| e2e of the Ask PZM page in a browser | **NOT RUN**: needs a staging project or emulator wiring for `/api/ask` |

## 3. Models: development set vs independent held-out set

**The two sets:**
- **dev** = `ask-pzm-v1` (126 rows, written beside the guard: an upper bound).
- **held-out** = `laya-v1` (459 rows, generated in G17 before Ask PZM existed; mapped to Ask
  PZM outcomes, 16 "suspicious" rows excluded).

`SUPPLIER_QUERY` ("when will PO-x arrive") maps only approximately to `po_unconfirmed`, so that
group's held-out score is low by construction.

**How to read the tables:**
- **Unsafe** = a write or injection request answered as a read. Nothing can be written by Ask
  PZM, but it counts.
- **acc** is accuracy; dev / held-out.

| Arm | acc | Thai | English | Mixed | **Unsafe** | p95 latency |
|---|---|---|---|---|---|---|
| A guard + router (no model) | 0.881 / **0.418** | 0.810 / 0.351 | 1.000 / 0.648 | 0.833 / 0.252 | **0 / 0** | < 1 ms |
| B English alone | 0.643 / 0.377 | 0.357 / 0.178 | 0.881 / 0.559 | 0.690 / 0.472 | 11 / **181** | 617 / 782 ms |
| B multilingual alone | 0.698 / 0.486 | 0.571 / 0.372 | 0.786 / 0.586 | 0.738 / 0.545 | 15 / **124** | 221 / 253 ms |
| E guard + router + English (τ 0.8) | 0.897 / 0.440 | 0.810 / 0.351 | 1.000 / 0.655 | 0.881 / 0.325 | **0 / 0** | 511 / 997 ms |
| E guard + router + multilingual (τ 0.8) | **0.929** / 0.444 | 0.881 / 0.377 | 1.000 / 0.655 | 0.905 / 0.301 | 0 / **7** | 197 / 204 ms |

**What the held-out set says:**
1. **The keyword guard does not generalise.**
   - It caught 108 of 296 writes and injections: Thai 31/126, English 77/105, **mixed 0/65**.
   - Without a model, a miss falls to "clarify", so arm A stays 0 unsafe.
   - With a model, misses get answered as reads. The 7 multilingual cases are all Thai purchase
     or receive requests, e.g. "สั่งมอส 11 ถุง เข้าสุขุมวิท" ("order 11 bags of mozzarella for
     Sukhumvit").
2. **The multilingual checkpoint is the better model for PZM:**
   - Thai 0.571 vs 0.357 on dev, 0.372 vs 0.178 on held-out;
   - **about 3× faster** on this CPU.
   - But it is not good enough to route on.
3. **No automatic promotion.** All data is synthetic. The guard was **not** re-tuned on the
   held-out set; doing so would destroy it as evidence.

**Next to change the verdict:**
- a write-intent detector that is not keyword-based (e.g. Laya's own `noul` "does it ask to
  change data?", calibrated on dev only);
- then a **new** held-out set, ideally real anonymised staff messages, and the 0-unsafe bar.

## 4. Runtime cost

| | English | Multilingual | Reflex modelless | Gateway |
|---|---|---|---|---|
| Startup to ready | 19.3 s | 15.2 s | < 1 s | < 1 s |
| RAM | ≈ 2.0 GB (free RAM 5.0 → 3.0 GB) | ≈ 2.0 GB (4.8 → 2.8 GB) | 7 MB | ~50 MB [estimate] |
| CPU | all 6 cores per call, ~1 CPU-s/call | lower (3× faster) | negligible | negligible |

**Coexistence:**
- Measured beside the running office apps (OneDrive, Chrome, Claude, Edge WebView); nothing was
  closed.
- Two Laya processes at once would use about 4 GB of 16; run **one**.
- **Qwen/vLLM: NOT RUN.** No local LLM is installed on this host, and vLLM needs a GPU.

**Firestore reads per Ask PZM request** (measured in tests; 2 of every total are the caller
check):

| Tool | Reads |
|---|---|
| Stock, product + site | **5** |
| Stock, all sites | 3 + sites holding it (≤ 50) |
| PO awaiting confirmation | 2 + open orders (≤ 100) |
| Stockout explanation, one product at one site | ≤ 5 + that product's outgoing rows there (≤ 400) + open orders there (≤ 50); worst **≈ 455** |
| Guard refusal, out of scope, clarify | 2 |

**Per user per session:**
- the rate limit caps one isolate at 20 questions per 5 minutes;
- a typical session of 10 mixed questions ≈ 50–600 reads.

A WAF rate rule on `/api/ask` is still needed for a hard limit (owner).

## 5. Security risks

| Risk | State |
|---|---|
| A model overriding a deterministic DENY | Impossible by construction; tested for every label, and models are not even called on DENY |
| Writes through AI | None possible: read-only store wrapper; no write tool exists |
| Client-supplied role, brand or site | Role and sites from `users/{uid}` only. Brand selects a namespace exactly as the rules allow (no per-user brand membership in the data model; that would be an owner decision). |
| AI-generated ids | Never used. Product and site ids are resolved with a database read first. |
| Business data to models | Only the question text. No rows, no ids, no user. |
| Gateway exposure | Loopback + tunnel + Access service token + JWT re-check |

## 6. Rollback

| Area | How |
|---|---|
| Staging | Unset `ASK_PZM_ENABLED` and `VITE_ASK_PZM`, then rebuild staging. The route and the UI disappear. |
| Gateway | Stop cloudflared, or unset `AI_GATEWAY_URL`. Ask PZM continues without AI. |
| Production | Nothing to roll back: production refuses `/api/ask` in code. |

## 7. Owner decisions

1. Create the **staging Firebase + Pages project** (`DEPLOY_TIER=staging`, a non-production
   project). Ask PZM then goes live there with model routing **off**.
2. Gateway: the office PC or a small VM (≈ 200 vs 500–2,500 THB/month). Set up per
   `docs/release/ai-gateway-design.md`.
3. Allow collecting **anonymised real Ask PZM questions in staging** to build a real held-out set.
4. Keep the English checkpoint as the owner's selection, or add multilingual for the shadow
   measurement. Neither routes answers until item 3 passes.
