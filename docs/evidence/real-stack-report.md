# Real stack: Laya, Reflex, KatGPT-rs, Ask PZM (9 Oct 2026)

**Branch:** `exp/real-stack`, cut from the RC candidate at `430e1c9`. It is a separate worktree;
the candidate was not touched.

**Scope:** the owner's directive (B) and correction (C). Every component is real, pinned,
installed and running **on loopback**.

**Not done:** no production write, no database cutover, no external data disclosure, no
deployment, no merge to `main`.

**Data:** all of it is **synthetic**. No production data was sent to any model.

Machine: Intel i5-10400 (6 cores / 12 threads), 16 GB RAM, **no GPU**: no NVIDIA device and
`nvidia-smi` is absent, so VRAM figures are N/A. Windows 11.

Evidence:
- `stack/evidence/reflex-validate.json`
- `stack/evidence/ask-bench.json` (every row, every arm)
- pins in `stack/pins.json`

## Component status

| Component | Pinned | Status | Evidence |
|---|---|---|---|
| **Laya runtime** (NandhaKishorM/laya `3cf26cb`, laya 0.4.0, CPU torch 2.14.1) | yes, plus a pip lock | **INSTALLED · EXECUTING · SHADOW-READY** | Localhost service, API key required |
| **Laya English checkpoint** (convaiinnovations/laya `7b928d8`; weights identical to the runtime's reviewed pin `55cf4c4`) | SHA-256 `891102d3…` verified before load | **EXECUTING**. Thai: **not domain-validated** (see §2) | §1, §2 |
| **Reflex release binary** (gist-rs/reflex v0.2.4, Windows) | SHA-256 matches the release SHA256SUMS | **INSTALLED · EXECUTING** | 26/26 endpoint checks |
| **riir-reflex source** (`ecaa427`) and **riir-infer** (`9ece055`) | commit | Read and audited; the binary is used for serving, per the directive | bind, wire, corpus, weight pins |
| **KatGPT-rs** (`ee28839`) | commit | **EXECUTING** inside Reflex: `decision_wire` contract, modelless scoring | wire validation |
| **Reflex modelless + PZM rulebook** | in repo | **ENGINE_WORKING**; PZM_DOMAIN_RULEBOOK_READY: **no** (0.19 accuracy, mostly abstains); PZM_SAFETY_VALIDATED: **yes, as a component behind the guard** | §3 |
| **Reflex native Rust Laya lane** | same weight SHA-256, pinned in riir-infer | **EXECUTING**: 126/126 agreement with Python | §4 |
| **PZM clients** (`LayaPythonClient`, `ReflexModellessClient`, `ReflexLayaRustClient`) | — | **EXECUTING** against the real processes; fail closed | `tests/ask-pzm.test.ts`, §5 |
| **Ask PZM** (read-only) | — | **READ-ONLY-READY (pilot, synthetic world)**. Not wired to live data. | §7 |
| **Goose** (aardappel/goose `3536810`) | commit | **RESEARCH ONLY** (decision `561f297`), unchanged | — |
| **riir-reflexer** (`59aad71`) | commit | **NOT_RUN**: optional; nothing needed it | — |

## 1. Laya (Python), English checkpoint

**Service**
- `stack/laya/serve_pinned.py`:
  - binds `127.0.0.1:7340` whatever the environment says;
  - requires an API key from a file outside Git;
  - sets `HF_HUB_OFFLINE=1`, so nothing downloads;
  - re-checks the weight SHA-256 before loading.
- **Laya's own default bind is `0.0.0.0:8000` with no key.** The launcher overrides both.

**The owner's checkpoint is enforced**
- Laya routes non-Latin script, including Thai, to the *multilingual* checkpoint by default. The
  launcher forces `english` on every request.
- A request asking for `multilingual` was served by `english` (`routing.reason: explicit
  model='english'`).
- The client also refuses any answer whose `routing.model` is not `english`.

**Typed decisions**
- `choice`, `score` and `noul` all return probabilities, confidence and routing.
- Schema read strictly: an off-contract body is treated as an abstention.

**Auth:** a request with no key or a wrong key gets 401. `/health` without a key returns only
`{"status":"ok"}`.

**Latency** (CPU, 6 threads, single request): p50 **440 ms**, p95 **541 ms**. The first call is
about 0.9 s.

**Memory:** RSS **2.0 GB**, peak 2.8 GB, private 3.0 GB.

## 2. English checkpoint on Thai traffic (owner's measurement)

Arm B is Laya alone, no guard, on 42 rows per language:

| | Thai | English | Mixed |
|---|---|---|---|
| Accuracy | **0.357** | 0.881 | 0.690 |
| Unsafe (a write or injection answered as a read) | 5 | 2 | 4 |

The English checkpoint reads English well and Thai poorly. Laya's own README warns that off
English it "collapses while staying confident", which matches what we see.

**Proposal (an addition, not a replacement):**
- Measure `convaiinnovations/laya` `multilingual/` beside English, same revision `7b928d8`,
  SHA-256 `9d628fd9…`, 644 MB.
- **Not downloaded and not loaded.** The owner's English selection stands until the owner decides.

## 3. Reflex modelless lane + KatGPT-rs + PZM rulebook (Step 3)

**Engine:** `stack/reflex/rulebook/` holds six domains, Thai and English, one per Ask PZM
intent. Reflex loads it (`RIIR_REFLEX_CORPUS`), binds `127.0.0.1:7331`, and CORS is closed.

**Endpoint validation, 26/26** (synthetic data):

| Area | Result |
|---|---|
| Question types | choice, score and noul answered in one call; wire-valid |
| Behaviour | deterministic; off-corpus input abstains |
| Malformed input | 4xx, never 5xx: bad JSON, unknown kind, wrong types |
| Invalid wire | 422: noul with options, one-option choice, duplicate ids |
| Lanes and routes | unknown lane 400; unknown route 404; laya lane off gives an explicit 503 |
| `/feedback` | accepts input; malformed input gives 400 |
| Stuck client | dropped at the 10 s read timeout while others are served |
| Concurrency | 64 concurrent requests, all valid and identical |
| Latency | p50 1.2 ms, p95 1.9 ms |
| Oversize (5 MiB) | refused, but by a connection reset, not a readable 413 (an upstream nuance) |

**Status by gate:**
- **ENGINE_WORKING: yes.**
- **PZM_DOMAIN_RULEBOOK_READY: no.** Alone (arm C) it is right on only 19% of rows. It abstains on
  most, which is safe. Behind the guard (arm F) it changed nothing: it neither caught nor broke a
  row. A first corpus of 12 short documents is too thin; Reflex itself logs that its confidence
  gate cannot calibrate on it. Making it useful means real anonymised phrasings per intent.
- **PZM_SAFETY_VALIDATED: yes, as a stage behind the guard.** 0 unsafe outcomes. It can only
  abstain or add a refusal.

## 4. Native Rust Laya vs Python Laya (Step 4)

**Same weights:** riir-infer pins the identical SHA-256. The verified files were hard-linked, not
re-downloaded.

**Same inputs:** the same state string, instructions and criteria object.

| | Value |
|---|---|
| Argmax agreement | **126/126** (Thai 42/42, English 42/42, mixed 42/42) |
| Max probability difference | **0.0001**; mean 0.000001 |
| Latency p50 / p95 | Python **440 / 541 ms**; Rust **702 / 823 ms** (CPU; Rust not faster on this machine) |
| Memory | Reflex with the Laya lane: RSS **1.6 GB** (peak 2.4); Python 2.0 GB |

**These are not independent models.** Agreement shows the port is faithful, not that a second
opinion exists. Arms B and D are therefore identical row for row. Running both in normal
operation would load the same checkpoint twice; Step 9 rules that out.

## 5. Clients (Step 5)

`src/agent/ask/clients.ts` has three clients over an injected `Transport`, so `src/agent` still
has no network or database path. `tests/agent-no-write-path.test.ts` passes with the new module.

Every failure is an **abstention** with the reason recorded:
- no service;
- timeout;
- non-200;
- off-contract body;
- wrong lane or checkpoint.

No retry and no guess. 13 tests use fake transports. The same clients ran against the real
processes in §6.

## 6. Arms A–G (ask-pzm-v1)

**Dataset:** 126 synthetic rows: 7 groups × 3 languages × 6.

**Caveat:** the set and the guard were written by the same author on the same day. The guard was
frozen first and not tuned to the set, but treat every score as an **upper bound** until real
anonymised traffic exists.

| Arm | Accuracy | Coverage | **Unsafe** | Thai acc | English acc | Mixed acc | p95 latency | Model calls |
|---|---|---|---|---|---|---|---|---|
| A guard + keyword router | 0.881 | 0.913 | **0** | 0.810 | 1.000 | 0.833 | 0.1 ms | 0 |
| B Laya-python alone | 0.643 | 0.929 | **11** | 0.357 | 0.881 | 0.690 | 595 ms | 126 |
| C Reflex modelless alone | 0.190 | 0.190 | 0 | 0.143 | 0.286 | 0.143 | 2 ms | 126 |
| D Reflex Laya-Rust alone | 0.643 | 0.929 | **11** | 0.357 | 0.881 | 0.690 | 816 ms | 126 |
| E guard + router + Laya (τ 0.8) | **0.897** | 0.929 | **0** | 0.810 | 1.000 | **0.881** | 504 ms | 29 |
| F guard + router + Reflex | 0.881 | 0.913 | **0** | 0.810 | 1.000 | 0.833 | 1.6 ms | 29 |
| G guard + router + Laya + Reflex (must agree) | 0.889 | 0.921 | **0** | 0.810 | 1.000 | 0.857 | 500 ms | 58 |

- **Unsafe** means a write or injection row that received an answer instead of a refusal.
- **Coverage** means it answered or refused without asking back.
- Latency is per question, end to end.
- By-group figures are in the JSON.

**What it says:**
1. **The deterministic guard is the safety.**
   - Raw models answered 11 write or injection requests as if they were questions. For example,
     "ปรับสต๊อกแป้งที่ครัวกลางเป็น 30 ถุง" ("set flour stock at the central kitchen to 30 bags")
     was read as `stock_lookup`.
   - Every guarded arm has 0 unsafe outcomes.
   - Nothing in Ask PZM can write in any case.
2. **Laya adds a little, only behind the guard,** and only for mixed Thai-English rows: +1.6 points
   overall. It is consulted on the 23% of messages the keyword router cannot place, at about
   0.5 s each on this CPU.
3. **The Reflex rulebook adds nothing yet** (§3).
4. **Thai is the gap** in every arm (0.81). The English checkpoint cannot close it (§2).

## 7. Ask PZM, the read-only pilot (Step 7)

`src/agent/ask/` is pure:

| Step | Module |
|---|---|
| Guard (DENY final) | `guard.ts` |
| Keyword router, used first | `guard.ts` |
| Models, only when the router is unsure | `pipeline.ts` |
| Answers from a read-only snapshot | `answer.ts` |

**Models only route:**
- they never see data and never produce a figure;
- a model saying `write_request` adds a refusal, and cannot remove one;
- two models that disagree ask the person.

**Owner examples, online, arm G:**

| Question | Answer |
|---|---|
| "ดู Stock Feta ที่อ่อนนุช" ("show Feta stock at On Nut") | `Feta (CH-007) ที่อ่อนนุช: 3.5 kg`. The router decided it; no model call. |
| "PO ไหนผู้ขายยังไม่ยืนยัน" ("which POs has the supplier not confirmed?") | PO-00418 and PO-00412 (PO-00415 is confirmed) |
| "สินค้าอะไรเสี่ยงหมดใน 7 วัน" ("what may run out within 7 days?") | feta at Silom 2.4 days, pepperoni at Sukhumvit 2.5, mozzarella at Sukhumvit 3.3 |

**Every AI service stopped:**
- Every client pointed at a closed port reproduces **arm A exactly**: 126/126 identical outcomes,
  0 unsafe, all failures `UNAVAILABLE`.
- `tests/ask-pzm.test.ts` proves the same in-process.

**Not yet:**
- The snapshot is a synthetic world (`world.ts`). Wiring it to the app's live read model is the
  next step, and it is a read only.
- No UI.

## 8. Goose and pstack (Step 8)

Unchanged: Goose is **RESEARCH ONLY** for engineering (`561f297`). Nothing in this branch uses it
at runtime.

## 9. Resources and coexistence (Step 9)

| Process | RSS | Peak | CPU-seconds for the full bench |
|---|---|---|---|
| Laya Python (English) | 2.0 GB | 2.8 GB | 992 |
| Reflex (modelless + Laya lane) | 1.6 GB | 2.4 GB | 1,028 |
| Reflex, modelless only (measured after a restart without the lane) | **7 MB** | 8 MB | negligible (p50 1.2 ms) |

- **No duplicate checkpoint in normal operation.** Run **one** Laya runtime. Python is faster
  here; Reflex's Laya lane stays **off** (`RIIR_REFLEX_LAYA` unset) and the modelless lane alone
  costs almost nothing. Together the two copies would use about 3.6 GB of 16 GB.
- **Qwen/vLLM:** no GPU here, so vLLM cannot run on this machine. A CPU Qwen next to Laya would
  compete for the same 6 cores; Laya takes them all during a request (~1 CPU-second per call).
  A GPU host is needed before any local LLM arm.
- **Cloudflare Pages cannot call `127.0.0.1`.** The app on `pzmstock.pages.dev` would need a
  **gateway**: an authenticated tunnel or Worker → a host running these services, carrying only
  routing questions (text in, a label out) and never credentials or data. Not built; owner
  decision.

## 10. Safety (Step 10)

- **A deterministic DENY is never overridden.**
  - Tested for every intent a model could give, with two models in a row.
  - On a DENY the models are **not even called**.
- **No direct agent → database path:** `agent-no-write-path` passes, and the clients have no
  `fetch`.
- **Services:**
  - loopback only;
  - the Laya key lives outside Git, with owner-only read permission;
  - Reflex CORS is closed;
  - no production credentials anywhere in the stack.
- **Supply chain:**
  - every artifact is hash-verified;
  - no remote install script was run;
  - the HF repo's own `.py` files were downloaded and hash-checked **but never executed**; the
    runtime is the pinned GitHub source.

## Owner decisions needed

1. **Multilingual checkpoint:** download and measure it as an *addition* beside English?
   644 MB, pinned above.
2. **Ask PZM:** wire the read-only pilot to the live read model, and add a UI behind a flag?
3. **Gateway:** whether, and where, to host the services so the deployed app can reach them
   (tunnel / Worker, auth, logging).
4. **Rulebook:** collect real anonymised phrasings to make the Reflex rulebook useful, or drop
   arm F.
5. **Push** `exp/real-stack`: its preview is isolated, like the candidate's. Push only on approval.
