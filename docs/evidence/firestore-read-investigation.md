# P0 Firestore production reads, 6–7 Oct 2026: investigation

Owner brief of 8 Oct. The owner reported:
- about **690K** reads on 6 Oct;
- about **55K** reads on 7 Oct.

The budgets are:

| Level | Reads per day |
|---|---|
| Target | < 20K |
| Investigate | > 30K |
| Urgent | > 40K |
| Free quota | 50K |

**Status:** OPEN, narrowed (9 Oct, §8). The spike is about 630K reads in hourly bursts from
6 Oct 20:00 to 7 Oct 10:00 ICT, and nearly all of it **bypassed the security rules**. It is
therefore admin, service-account or console access, not the app's users. The process itself is
not yet named; §8 lists the two checks that would name it. No code on this branch was deployed,
and nothing was disabled.

Each fact below says how it was established:
- **[live]** read from Cloudflare or Firebase today;
- **[repo]** from git;
- **[measured]** from a benchmark;
- **[model]** an estimate.

## 1. What was actually running

### Production app (Cloudflare Pages, `main`) [live + repo]

Times are commit times in ICT (UTC+7). Pages builds within minutes of the push.

| Deployed commit | Time | Notes |
|---|---|---|
| `0556552` | 5 Oct, 22:23 | |
| `d7485c0` | **6 Oct, 09:43** | Supplier-intel S3–S5, notifications N4–N8 (risk and supplier events, live PO page), delivery-risk panels |
| `6f747aa`, `5d460a7`, `c66f77d`, `7e5965e` | 6 Oct, 10:10 – 10:54 | OCR, import and popup fixes. **Four more production deploys in 70 minutes.** |
| `2a8d578` | **6 Oct, about 23:42** | The read-cost fix: device copies, delta refresh, recipient-scoped bell. Still live (deployment `dbee8792`). |

### Firestore indexes [live]

The same 4 indexes as `firestore.indexes.json`; Firestore adds the trailing `__name__` itself.
The recipient-scoped notification query therefore runs on its index, with no fallback path.

### Firestore rules [not verified]

The CLI has no read-only "show deployed rules" command. Check them in the console (Rules →
history) against `firestore.rules` at `2a8d578`.

### Cron Worker `pzmstock-cron` [live]

- The **first deployment ever** was on **7 Oct at 10:48 UTC (17:48 ICT)**, followed by a
  secret change 2 s later. **It did not exist on 6 Oct.**
- **Both live versions report only a `fetch` handler.** The source exports `scheduled` as well.
  - It is therefore **unverified that the crons fire at all**.
  - If they don't, `meta/cronStatus` stays stale, and every manager or admin browser keeps
    running the notification job every 30 minutes (`shouldRunNotifications`).
  - **Owner check:** Cloudflare → Workers → `pzmstock-cron` → Triggers and Logs, or the
    `meta/cronStatus` document in Firestore.

### Preview deployments [live]

- 25 preview deployments; every one ships the production client config (see
  `preview-isolation.md`).
- Each preview URL is its own origin, so it has **no device copies**: every open is a full
  cold read against production.
- None of this traffic shows in `readMeter` (it is per device, and only in builds from
  `2a8d578` on).

## 2. The day boundary

The free quota resets at **midnight Pacific time** (PDT in October, UTC−7), which is **14:00
ICT**. So "6 Oct" in the Firebase usage view most likely covers **6 Oct 14:00 ICT → 7 Oct
14:00 ICT**.

- That window holds about **9.7 h of the pre-fix build** (`7e5965e`), then the deploy of the
  fix and its cold reads, then about 14 h of the fix.
- If the owner read the figures in a view using local days, the windows shift. **Confirm which
  view the 690K and 55K came from.**

## 3. Attribution of 6 Oct (about 690K)

The per-scenario costs come from main's own "before" benchmark, which is
`read-budget-before.json`.

- It was **measured on exactly the code live that afternoon**: `7e5965e` is an ancestor of the
  benchmark commit `489ccf5`.
- It used a real backup (336 products, 524 balances, 3,173 movements, 130 POs).

| Component | Basis | Estimate |
|---|---|---|
| Normal use, pre-fix build, about 10 devices × about 9.7 h | [measured] about 20.8K per device per active day → about 870 per device-hour | **about 85K** |
| Manager browser job (no Worker yet): about 3 devices × about 20 runs | [measured] about 1K per device per day pre-fix, plus a 45- and a 120-day PO range and up to 134 single reads per run | **about 5–15K** |
| The fix deploy (23:42): one full cold read per device | [measured] 1,426 (manager) / 1,215 (staff) | **about 13K** |
| Five production deploys in the morning: every open device reloads on the update prompt and cold-reads | [measured] about 1,300–1,555 each; **outside the PDT window if the day is PDT**; inside it if it is a local day | 0 (PDT) / **about 70K** (local day) |
| Fix build overnight to 14:00 ICT | [model] about 1.5K per device per day, pro rata | **about 8K** |
| Two production backup exports (the 6 Oct 15:00 backups that main's benchmark loads) | [model] one read per document; about 5–10K documents each | **about 10–20K** |
| Owner and testers opening production-connected **preview** URLs | [unmeasured] about 1,400–1,555 per open, more for a long session on a pre-fix preview | **unknown** |
| Firebase **console data viewer** (browsing collections counts as reads) | [unmeasured] | **unknown** |
| **Explained** | | **about 120–150K (PDT day)**, about 190–220K (local day) |
| **Unresolved** | | **about 470–570K** |

**Unresolved attribution: about 70–80% of 6 Oct.** The measured device model cannot produce
690K: that would need about 7,900 device-hours of the pre-fix build in one day. Candidates, in
the order I would test them:

1. **Notification fan-out under the pre-fix bell.** Before the fix, every device listened to
   **all** notifications from the last 7 days, so each notification write or mark-read cost
   one read on every device.
   - `d7485c0` added the N4–N8 risk and supplier events that morning.
   - If the risk job re-arms or rewrites documents on each 30-minute run on several manager
     devices, the result is writes × devices.
   - The tested jobs are idempotent (`notifications-service.test.ts`: a second run writes 0),
     but the **risk** job's re-arm path is not covered by that test.
2. **Preview traffic**, see the rows above.
3. **An admin export or console browsing larger than estimated.**
4. **A reconnect storm.** Pre-fix, a resume after more than 30 minutes re-read whole
   listeners (1,055 per resume). A flaky network on one device that re-attaches every few
   minutes would multiply this. This is not observable without per-device logs, which the
   pre-fix build did not have.

## 4. Attribution of 7 Oct (about 55K, under the fix)

| Component | Basis | Estimate |
|---|---|---|
| Steady state after the fix, about 10 devices | [measured/model] main's projection | **about 18K** (busy day 29K) |
| The fix's one-off full read on each device that had not opened yet (per brand) | [measured] 1,215–1,426 per device | **about 5–15K** |
| Browser notification job still running (the Worker didn't exist until 17:48, and may not fire, see §1) | [measured] about 1K per manager device | **about 3K** |
| Worker crons **if** they run: `active == true` sweep every 30 minutes | [model] main's estimate | 0 – **about 6K** |
| **Le Lapin** brand: separate `lelapin__*` collections, so a separate full first read and steady state per device that uses it | [model] | **about 2–10K** |
| Preview URLs and console browsing | [unmeasured] | unknown |
| **Explained** | | **about 30–55K** |

7 Oct is **within the model's range**, but its top end needs every one-off cost at once.

- From 8 Oct the one-off device reads disappear, so **8 Oct is the first clean day to
  measure**.
- **Expected:** 18–29K. Above 30K means the investigation continues, per the brief.

## 5. readMeter versus billing

- `readMeter` exists only in builds from `2a8d578` onward. It counts per device, and estimates
  billing:
  - a local cache hit costs 0;
  - an empty query costs 1;
  - a resume after more than 30 minutes costs the full result.
- It **cannot** see:
  - other devices;
  - preview origins (each has its own meter, which nobody reads);
  - the Worker (REST, server side);
  - backups and admin scripts;
  - the Firebase console;
  - rule-evaluation reads (`get()` / `exists()` in rules are billed reads; the rules use
    them, for example for role lookups).
- **Billing − Σ meters** is therefore the size of these blind spots, and needs the per-device
  figures. **Owner:** on 8 Oct, read Settings › การอ่านข้อมูล on each device and write down
  the totals.

## 6. What closes the gap

This needs owner access to the GCP project. Nothing is changed by these steps.

1. **Cloud Monitoring, hourly**, metric `firestore.googleapis.com/document/read_count` for 5–8
   Oct (Console → Monitoring → Metrics explorer).
   - The hour of the spike tells the components apart:
     - 09:43–11:00 ICT points to the deploy reloads;
     - steady from 14:00 to 23:42 points to the pre-fix bell or job;
     - a step at specific minutes, like :00 / :30, points to a job;
     - a single block points to an export.
2. **Firestore Query Insights / Key Visualizer** for the same days: reads by collection. A
   `notifications` share well above about 20% confirms candidate 1.
3. **Cloud Audit Logs (Data Access, if enabled)** will show the reads of the console and the
   export by principal.
4. **The Worker:** confirm the cron triggers and look at the logs from 7 Oct, 17:48 onward.

## 7. Protecting the budget meanwhile (proposals, nothing applied)

- **Delete the old production-connected previews** (`preview-isolation.md`). This removes
  unmetered cold reads at once, at no cost.
- **Deploy the preview-isolation build** so that future previews read nothing.
- **Fix or confirm the Worker crons.** Until they fire, the browser job runs on every manager
  device.
- **Batch production deploys.** With device copies, one deploy is no longer a cold read, but
  the update reload still re-attaches listeners. Five deploys in 70 minutes was the costly
  pattern on 6 Oct.
- **No critical notification or workflow was disabled**, and none is proposed.

## 8. Hourly metrics, 4–9 Oct (read 9 Oct 2026, owner's project in Cloud Monitoring) [live]

**Source:** Cloud Monitoring, project `pzm-stock-x5`, PromQL, 1-hour steps. The raw exports are
in `docs/evidence/data/`:
- `firestore-reads-hourly-2026-10-04_09.csv` (`document/read_ops_count`);
- `firestore-rules-evaluations-hourly-2026-10-04_09.csv` (`rules/evaluation_count`).

**Daily totals (ICT days):**

| Day | Reads | Peak hour |
|---|---|---|
| 5 Oct | 37,920 | 9,405 |
| **6 Oct** | **366,473** | **107,198 (22:00)** |
| **7 Oct** | **372,104** | 75,060 (02:00) |
| 8 Oct | 81,956 | 8,365 |
| 9 Oct, to 10:00 | 2,529 | 2,036 |

The owner's "about 690K on 6 Oct" is a billing day (Pacific time, 14:00–14:00 ICT). It covers
the whole burst window below.

**The shape: bursts, not a steady leak.**
- About 630K of the reads fall between **6 Oct 20:00 and 7 Oct 10:00 ICT**.
- They come in single hours of 25K–107K: 20:00, 22:00, 23:00, then 01:00–03:00, 05:00–07:00 and
  09:00.
- Between them are ordinary hours of 1.7K–4K: 21:00, 00:00, 04:00, 08:00.

**Who made them: not the app's users.** Security-rule evaluations happen for every client-SDK
request and for no admin or service-account request. Through every burst hour they stayed at
their ordinary 1–3K per hour, and every one was ALLOW (no DENY at all):

| Hour (ICT) | Reads | Rule evaluations | Reads per evaluation |
|---|---|---|---|
| 6 Oct 18:00 (ordinary) | 2,495 | 1,004 | 2.5 |
| 6 Oct 20:00 | 106,149 | 2,432 | 43.6 |
| 6 Oct 22:00 | 107,198 | 2,973 | 36.1 |
| 7 Oct 00:00 (ordinary) | 1,720 | 1,037 | 1.7 |
| 7 Oct 02:00 | 75,060 | 2,221 | 33.8 |
| 7 Oct 12:00 (ordinary) | 4,301 | 1,354 | 3.2 |

Normal client traffic runs at about **2–3 reads per evaluation**. The burst hours carry about
**100K reads more than their evaluations account for**.

**Conclusion [inference from the two metrics]:**
- The excess was read by something that **bypasses the security rules**: the Admin SDK or a
  service-account script, the Firebase console's data viewer, or an export or backup run with
  admin credentials.
- **Ruled out** as the main source:
  - staff devices and app tabs, which all evaluate rules;
  - a listener retry loop, which would show as rule evaluations, likely DENY;
  - the cron Worker, which was a placeholder that never ran (§1).

**Still open.** Two things would name the process:
1. **IAM → Service accounts → Keys**, "last used" for each key of `pzm-stock-x5`. A key used in
   the window points to a script.
2. **Cloud Audit Logs → Data Access** for Firestore, if enabled. They name the principal per
   request. If they are not enabled, enable them for the next 30 days (owner decision; it costs
   log volume).

Repository commits in the window show heavy development by a cloud session
(`claude/phase-a-ledger-continue-uzbbb5`) and locally. Neither proves an admin run against
production. Status stays **OPEN, narrowed**: the source class is identified, the process is not.

**Protection now in place:**
- old previews deleted and the rest behind Cloudflare Access (9 Oct);
- preview keys separated from production (owner, 9 Oct).

**Still advised:** a Cloud Billing budget alert on Firestore reads at 40K/day.

## 9. Forensics, 9 Oct (owner-approved, read-only except enabling the audit log) [live]

**Service accounts** (IAM, `pzm-stock-x5`):

| Account | Keys |
|---|---|
| `firebase-adminsdk-fbsvc@…` | none |
| `pzmstock-functions@…` | **one key**, `fa49f26d…`, created 5 Oct. Used by the Pages Functions and the Worker. |

**That key's authentications** (Cloud Monitoring `service_account/key/authn_events_count`,
hourly, ICT):

| When | Authentications |
|---|---|
| 5 Oct 16:00 / 23:00 | 1 / 1 |
| 6 Oct 15:00 / 16:00 / 19:00 | 1 / 2 / 1 |
| **6 Oct 20:00 → 7 Oct 09:00** | **none** |
| 7 Oct 10:00 | 1 |
| 8 Oct 12:00–19:00 | 2–8 per hour |

**→ The key did not make the burst reads.** A token lives one hour, so a job using it would
authenticate in every burst hour. This also clears every repository path to production
(`functions/_lib/serverStore.ts`, `worker/src/firestore.ts`); both use this key.

**Admin Activity audit log** (always on; 6 Oct 17:00 → 7 Oct 12:00 ICT), 7 entries, all
`yutthachai@pizzamania.com`:

| Time (ICT) | Entries |
|---|---|
| 6 Oct 23:40 | Firebase Rules `CreateRuleset` + `UpdateRelease`, and 4 × Firestore `CreateIndex` (notifications, both brands). That is a `firebase deploy` of rules and indexes. |
| 7 Oct 09:56 | Cloud Billing `AssignResourceToBillingAccount` (the project linked to the current free-trial billing account) |

There was **no** export, import or backup operation in the window.

**Data Access audit logs** were **disabled** for Firestore, so no historical record names the
reader. **Attribution: UNVERIFIED.**

**Most consistent with the evidence, not proven:** a client using the owner's own Google login,
which never uses the key and bypasses the rules:
- the Firebase console's data viewer;
- or a desktop or CLI Firestore tool signed in as the owner.

**Changed today, with the owner's approval in chat:**
- **Data Access audit logs ON for the Firestore/Datastore API** (Admin read, Data read, Data
  write).
- Estimated about 2 GB of logs a month at current traffic, within Cloud Logging's free
  50 GiB/month.
- Review after 30 days.

**Not done (owner decisions):**
- **Rotate the key:** not justified by evidence. It shows no anomalous use, and it is in active
  use by production functions.
- Disable accounts: none suggested.

**Recommended:**
1. Cloud Billing **budget alert** (Firestore reads, e.g. alert at 40K/day-equivalent spend).
2. Narrow `pzmstock-functions` from `roles/datastore.user` to the least it needs. Today it reads
   and writes everything.
3. Avoid browsing large collections in the Firebase console data viewer: it reads every document
   shown and is not rule-checked.
4. If the pattern repeats, the Data Access log now names the principal and method within minutes.

**8–9 Oct pattern:**
- 8 Oct: 82K reads.
- Rule evaluations held about 2K/h around the clock on 7–8 Oct, including night hours. Devices or
  tabs stayed connected overnight.
- From 9 Oct 00:00 the night rate fell to about 570/h.
- Ordinary client traffic: about 2–3 reads per evaluation.
