# ASK PZM STAGING: GO / NO-GO (9 Oct 2026, evening)

**Branch:** `exp/real-stack` @ `0aed974` (plus this report). Never merged to `main`; production
refuses `/api/ask` in code.

**Verdict:**
- **GO to deploy into an isolated staging project**, once the owner has created one (BLOCKED
  until then).
- **AI model routing: NO-GO. Disabled in code.**
- **Production: NO-GO.**

Passing the safety gate here does not authorise production.

## 1. What changed since the last report

| Track | Change | Status |
|---|---|---|
| 2 | **Positive READ-only eligibility contract** (`src/agent/ask/eligibility.ts`): a read tool runs only for STOCK_LOOKUP / PO_UNCONFIRMED / STOCKOUT_RISK, positively matched, with every product, site, SKU and PO reference resolved against the database. Quantities, events, action requests, compound requests, quotes and pasted documents → refuse; unknown or ambiguous → clarify. | **PASS** |
| 2 | Models are **shadow-only**. `classify` was removed from the server path. A shadow hook is told the decision afterwards, never awaited, and cannot fail the request. | **PASS** |
| 2 | **Guided queries**: three explicit buttons with product, site and day pickers. They carry no free text; adding text to a guided request is a 400. | **PASS** |
| 2 | Name matcher bug fixed: Latin aliases match whole words only ("CK" matched "check" and "Pack Plus" → wrong site). | **PASS** |
| 3 | **Strict staging config** (`functions/_lib/stagingConfig.ts`): explicit project id = service-account project id = service-account email project; neither is `pzm-stock-x5`; **no fallback**; tokens verified against the staging project only; fails closed with no network call. | **PASS** (11 misconfiguration cases + no-network test) |
| 4 | Stockout tool reads only the **28-day window** (staging-only composite index, `stack/firestore.indexes.staging.json`). Capped reads are **never totals**: stock asks for a site; POs say "at least N"; risk gives no rate and no verdict. Movement cap 200. | **PASS** |
| 4 | **Global limit:** the Cloudflare Rate Limiting binding `ASK_RATE_LIMITER` (per user, edge-wide) is **required**; missing → 503. Per-isolate limiter kept as a first line. | **PASS** (code); binding to be created in staging |

## 2. Safety gate: unsafe read-tool execution

| Corpus | Rows | Independence | **Unsafe** | Non-reads refused or clarified | Reads answered | Abstained reads |
|---|---|---|---|---|---|---|
| `ask-pzm-adv-v1` | 81 | **Frozen before the contract** (`f7cd6e7`, SHA-256 `81506d72…`, unchanged); same author | **0** | 60/60 | 20/21 | 1 |
| `laya-v1` | 459 | G17 generator, earlier. **Used for development since its first run** (the "does *Supplier* have…" rule and the alias fix came from its failures), so no longer independent. | **0** | 381/381 | 32/78 | 46 |
| `ask-pzm-v1` (dev) | 126 | Development | **0** | 72/72 | 32/54 | 22 |
| Adversarial corpus **through the real server**, hints computed as the UI does | 81 | — | **0 tools run on must-not-run rows** | — | — | — |

**Unsafe and abstention are reported separately.** Most abstentions are deliberate scope limits,
for example a brand-wide "what will run out?" asks for one product and one site.

**Gate result:**
- 0 unsafe on every corpus available.
- But **no truly independent release corpus remains**.

The release gate therefore needs **50–100 real questions written by staff in staging** (without
seeing the rules), plus a manual review of known blind spots:
- slang not yet seen;
- Thai without spaces beside a quantity spelled in words ("ห้าโล");
- requests split across two messages.

**Status: BLOCKED on that corpus.**

## 3. Tests and versions

| | |
|---|---|
| Unit, whole repo | **1,851 passed, 1 skipped** |
| Ask server tests | 37 |
| Ask agent tests | 23 |
| Gateway tests | 9 |
| verify (types, lint, i18n, unit, safety, vectors, transition, Rust, differential, rules emulator) | **all PASS** |

**Runtimes:**
- Node 24.18, CPU only.
- Laya 0.4.0 / torch 2.14.1 (shadow benchmarking only).
- Reflex 0.2.4 (shadow).
- KatGPT-rs `ee28839` (inside Reflex).

## 4. Read budget (per request, measured in tests on the fixture world)

| Tool | Typical | Worst case (hard caps) |
|---|---|---|
| Caller check (every request) | 2 | 2 |
| Stock lookup, one site | **5** | 5 |
| Stock lookup, all sites in scope | 4 + sites | 2 + 1 + 50 → else "choose a site" |
| PO awaiting confirmation | 2 + open POs | 2 + 100 ("at least N" if capped) |
| Stockout, one product at one site | 5 + window rows + site's open POs | 5 + **200** + 50 = **255** (was 455) |
| Refuse / clarify | 2–4 | 2 + ≤3 PO + ≤3 SKU lookups |

- **Per user per day [projection]:** 30 questions × ~10 typical reads ≈ 300. The edge limiter
  bounds the worst case.
- **p50 / p95 on real data:** **NOT_RUN** (no staging data yet).
- **Latency:** in tests, single-digit ms plus Firestore round-trips; real staging measurement
  NOT_RUN.

## 5. Costs (monthly, staging) [estimates]

| Item | Cost |
|---|---|
| Firestore (staging, low use) | ≈ 0, inside the free quota |
| Cloudflare Pages + Functions + Rate Limiting binding | existing plan / free tier |
| AI gateway | **not needed**: routing is off (owner, 9 Oct: run on your own PC when needed) |
| Supabase | not involved |

## 6. Security findings

| Area | State |
|---|---|
| Writes | None possible: read-only store wrapper, no write tool, nothing in the DB changes (tested) |
| Identity | Role and sites from `users/{uid}` of the **staging** project. A production token fails verification. |
| Brand | One namespace per answer. There is no per-user brand membership in the data model (owner decision if wanted). |
| Client ids | Resolved against the database; unknown → clarify |
| Model | Cannot make a request eligible; shadow only |

## 7. Rollback

- Unset `ASK_PZM_ENABLED` / `VITE_ASK_PZM` on staging: the route and the UI disappear.
- Production has nothing to roll back.

## 8. Next deployment sequence (staging only)

1. Owner creates a staging Firebase project and a staging Pages project
   (`DEPLOY_TIER=staging`).
2. Deploy `stack/firestore.indexes.staging.json` to staging.
3. Create the `ASK_RATE_LIMITER` binding; set `ASK_PZM_ENABLED=true` and `VITE_ASK_PZM=on`.
4. Seed staging from a backup copy. **Owner decision:** staging may hold a copy of production
   data, or anonymised data only.
5. Staff write 50–100 questions blind; run the gate on them.
6. Measure p50/p95 reads and latency on real data.
7. Then a separate owner gate for anything beyond staging.
