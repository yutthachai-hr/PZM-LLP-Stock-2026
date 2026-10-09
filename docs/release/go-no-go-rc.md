# PRODUCTION RC: GO / NO-GO (9 Oct 2026, evening)

**Candidate:** `rc/ops-os-rc1-candidate`, Draft PR #1. **Verified head: `e3287fb`.**

**Verdict: NO-GO to merge.**
- Restore and integrity now pass.
- Still not done: the live G25 transition-rules rehearsal, compatibility checked against live
  clients, e2e ×3 on the exact final SHA, and the owner's separate approval of the
  transition-rules deploy.
- The read incident's source is **UNVERIFIED**; it cannot be proven with the logs that existed.

Green checks do not authorise a merge. Merging `main` deploys production.

Statuses: **PASS / FAIL / BLOCKED / NOT_RUN**.

## 1. Identity

| Item | Value |
|---|---|
| Production | `614fcc13` = `ad43971`; rollback `0d00ae76` = `903c8db` |
| Candidate | `e3287fb` (pushed, no force) |
| Runtimes | Node 24.18, React 19, Vite 8, firebase-tools 15.24, wrangler 4.148, Java 21 (emulator), Rust stable |

## 2. Gates

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | GitHub CI, 9 required checks, on `e3287fb` | **PASS** | typecheck, lint-i18n, unit, agent-safety, rust, rules, build-budget, e2e, secrets: all pass |
| 2 | Branch protection on `main` | **PASS** | Verified by API: PR required, 9 strict checks, admins enforced, 0 approvals, no force push or delete, conversations resolved |
| 3 | Local gates (verify) | **PASS** | unit (RC suite), rules 249, Rust, differential |
| 4 | e2e ×3 consecutive on **the exact final SHA** | **NOT_RUN** | ×3 on `44554aa`; CI ×1 on `e3287fb` |
| 5 | Backups, all three brands | **PASS** | Taken 9 Oct 10:41–10:43 by Claude at the owner's request (`docs/evidence/restore-rehearsal-2026-10-09.md`) |
| 6 | Restore rehearsal, isolated, 3 brands | **PASS** | App restore → re-export → identical records, ledger stamp identical, drift 0; wrong-brand restore refused |
| 7 | Restore integrity checks | **PASS** (app auditor: 0 critical) / **known limit** (TS+Rust reference agree; their `PO_RECEIVED_EQ_RECEIPTS` rule misreads legacy receipts and entry units) | same doc §3 |
| 8 | Restore into a real isolated Firebase project | **NOT_RUN** | Needs a separate project (owner) |
| 9 | G25 transition rules, emulator | **PASS** | `tests/rules-transition.test.ts` |
| 10 | G25 transition rules, **actual rehearsal** against a project | **NOT_RUN** | Needs the owner's separate approval to deploy rules (checklist §B) |
| 11 | Compatibility with existing production clients | **NOT_RUN** live; **PASS** on the emulator (old client, version unchanged, accepted) | — |
| 12 | Old-client detection | **PASS** (code) | `x-pzm-build` on stock commands |
| 13 | Rollback validation | **PASS** documented; **NOT_RUN** live | runbook §9 |
| 14 | Preview isolation | **PASS** | Code guard + Cloudflare Access on `*.pzmstock.pages.dev` (re-probed: every preview 302 to login; production 200) |
| 15 | Read incident | **OPEN: attribution UNVERIFIED** | `docs/evidence/firestore-read-investigation.md` §8–9 |
| 16 | R&D units | **BLOCKED** (owner data); release is safe with R&D restricted | Template: KG / EA / Pack / Carton; 17 suggestions, none applied |
| 17 | Cron Worker | **NOT_RUN** (OFF by decision) | — |

## 3. Security findings

| Finding | Severity | State |
|---|---|---|
| About 630K rule-bypassing reads, 6 Oct 20:00 → 7 Oct 10:00 ICT | **High until explained** | The only service-account key was **not used** in the window. Admin Activity shows no export. Data Access logs were **off**, so attribution is **UNVERIFIED**. **Now ON** for Firestore. |
| Service account `pzmstock-functions` holds `roles/datastore.user` (read and write everything) | Medium | Recommend least privilege; not changed |
| Key rotation | — | **Not justified** by evidence; not done |
| Public demo preview now behind Access | Low | Owner may add a Bypass for that hostname |
| Old previews | Closed | Access + guard |
| Single-account repository | Medium | CI and PR enforced; review is self-review |

## 4. Read budget and cost

- **The RC adds no reads at rest.** All new features are flagged off.
- Normal traffic: 1.7–4K reads per hour. Since 9 Oct 00:00 nights run about 570 per hour.
- Incident cost: about US$0.2–0.4 at list price.
- Projected monthly Firestore cost at normal traffic (about 30–60K reads a day): **≈ US$0–1**,
  mostly inside the free quota.

## 5. Rollback

| Area | How |
|---|---|
| App | Pages rollback to `614fcc13` |
| Rules | `rules.prod.bak` (after the app) |
| Data | The 9 Oct backups, rehearsed in isolation today |

## 6. Remaining owner actions, in order

1. Approve the **transition-rules deploy** as a separate step (checklist §B), then rehearse and
   validate it against live clients.
2. Name the final SHA. Claude runs e2e ×3 on it.
3. Optionally provide an isolated Firebase project for a full restore into Firestore.
4. Watch the Firestore Data Access log for 1–2 weeks. Decide on least privilege for
   `pzmstock-functions` and on a billing budget alert.
5. Then the explicit merge approval for that SHA.

## 7. Next deployment sequence

Backup (done today, repeat on the day) → transition rules (approval) → validate old clients →
merge (approval) → workflows check → old clients gone by evidence (`x-pzm-build`) → strict rules
→ 3-day monitoring.
