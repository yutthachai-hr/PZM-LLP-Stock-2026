# Owner gates: production external dependencies (8 Oct 2026)

These gates need the owner's Cloudflare and Google Cloud access. **Nothing here has been
executed.** Every command below is read-only unless it is marked **DELETE**.

| Gate | What | Status |
|---|---|---|
| A | Delete old production-connected Preview deployments; separate Preview secrets and bindings | **BLOCKED (owner)** |
| B | Cron Worker: deployed code differs from source; scheduled handler missing | **BLOCKED (owner): investigation result below** |
| C | Firestore hourly metrics for 5–8 Oct | **BLOCKED (owner): export needed.** The 6 Oct spike stays an **open incident**. |

---

## A. Cloudflare old Preview cleanup

### Facts established read-only on 8 Oct, about 14:50 ICT

- **Production, re-checked 8 Oct in the evening: `614fcc13` = `ad43971`** (the owner's two
  pushes after 14:36). Before it: `0d00ae76` (`903c8db`), then `aa6b85cb` (`476fa35`).
  **Never delete `614fcc13`.** Keep `0d00ae76` as the rollback target.
- The re-check also found **24 of 24** pre-isolation previews still reachable.
- **`wrangler pages deployment list` returns at most 25 rows** (one API page). The newest
  page holds 3 production and 22 preview deployments, so **older deployments exist beyond
  it**. The full inventory needs the paginated API call below.
- **Every listed pre-isolation preview is reachable** at its hash URL (HTTP 200).
- Their sign-in screen says **"โหมด Cloud — ข้อมูลซิงก์ทุกเครื่องแบบเรียลไทม์"**: a client
  connected to production. It makes no request until someone signs in, and then it reads and
  writes **live data under the live rules**, using that preview's unreleased code.
- Their `/api/stock/*` and `/api/supplier/*` answer `not_configured`: the Preview environment
  has **no service account**.
- They do still hold:
  - the **shared `PO_IMAGES` KV** and the **`AI` binding** (`wrangler.toml` has no
    `[env.preview]`);
  - a **live Preview `GEMINI_API_KEY`** (`/api/ocr-bill` would spend it).
- The isolated preview `e2bd3503` (`0261c48`) answers `preview_isolated` (503) on every
  privileged route.
- **Branch aliases are not hash URLs.** `demo`, `feat-outbox`, `perf-firestore-read-budget`,
  `bench-read-compare` and `integration-ops-os-rc1` `.pzmstock.pages.dev` all resolve (200).
  - An alias always points at the **latest** deployment of its branch.
  - Deleting older hash deployments does not remove an alias.
  - A branch whose latest deployment is pre-isolation keeps a production-connected alias
    until that branch is rebuilt with the isolation code, or until all its deployments are
    deleted.
- **Custom domains:** the project lists only `pzmstock.pages.dev`. If a custom domain is
  added later, it must be added to `PRODUCTION_HOSTS` in both places (see
  `preview-isolation.md`).
- **Preview protection:** Cloudflare Access on previews protects the hash URLs and aliases
  it covers. It is **not** a substitute for deleting them or for separating their secrets.

### A.1 Full inventory (read-only)

Create an API token with **Account › Cloudflare Pages › Read**. Never paste it into chat or
a file. Then run:

```bash
for p in 1 2 3 4 5 6; do curl -s "https://api.cloudflare.com/client/v4/accounts/dc0c72ca65f1d5eea15758565cd427f7/pages/projects/pzmstock/deployments?per_page=25&page=$p" -H "Authorization: Bearer $CF_API_TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const d of JSON.parse(s).result)console.log(d.id,d.environment,d.deployment_trigger.metadata.branch,d.deployment_trigger.metadata.commit_hash.slice(0,7),d.created_on)})"; done
```

### A.2 The newest 25, resolved

| Deployment id | Branch | Commit | Client |
|---|---|---|---|
| `e2bd3503-7e7b-4eaf-b4ea-979e83ebe937` | integration/ops-os-rc1 | `0261c48` | isolated (keep or delete) |
| `6a06a8ef-d58f-4630-a0f2-40df37b11ba2` | bench/read-compare | `287837b` | **pre-isolation: production client config** |
| `91f2fc7d-efc5-474d-a2b6-c875c25ed9fb` | claude/phase-a-ledger-continue-uzbbb5 | `2ae7bbb` | **pre-isolation: production client config** |
| `09a49098-9003-4bad-b6e7-33202957ff1d` | claude/phase-a-ledger-continue-uzbbb5 | `6434c0f` | **pre-isolation: production client config** |
| `28da8d45-f06b-4b8b-b717-9fb476692c00` | claude/phase-a-ledger-continue-uzbbb5 | `6e54902` | **pre-isolation: production client config** |
| `2e43422d-bf7c-42bd-a364-426e52727823` | claude/phase-a-ledger-continue-uzbbb5 | `9b2437f` | **pre-isolation: production client config** |
| `4d1fa850-864a-4da8-b2cf-87694ef9d3ec` | claude/phase-a-ledger-continue-uzbbb5 | `69ed912` | **pre-isolation: production client config** |
| `f49785e7-1243-4911-9ac8-d768eafe1f32` | claude/phase-a-ledger-continue-uzbbb5 | `37c37e9` | **pre-isolation: production client config** |
| `3814be9f-5cae-4300-9e36-c3e3a70a15b6` | claude/phase-a-ledger-continue-uzbbb5 | `8678288` | **pre-isolation: production client config** |
| `219e5e7a-1687-446d-99a9-f32e35b68e31` | claude/phase-a-ledger-continue-uzbbb5 | `1e797a3` | **pre-isolation: production client config** |
| `1e3bf588-0d08-4b80-ae07-9487c9d3f605` | claude/phase-a-ledger-continue-uzbbb5 | `d2fe730` | **pre-isolation: production client config** |
| `d7c9abfd-66e6-49ac-853f-a423d84b63dd` | claude/phase-a-ledger-continue-uzbbb5 | `82f8949` | **pre-isolation: production client config** |
| `88d7433e-3960-41c8-b361-49693c3a153a` | feat/outbox | `15b428e` | **pre-isolation: production client config** |
| `932d8a9f-a2ee-4ea8-a8ec-bb2d3b358d4a` | claude/phase-a-ledger-continue-uzbbb5 | `1f3dece` | **pre-isolation: production client config** |
| `34c4c639-9898-4b65-99b1-5345b4c8b7e6` | claude/phase-a-ledger-continue-uzbbb5 | `a4e4482` | **pre-isolation: production client config** |
| `205f2357-690b-4ba0-a362-7a5d2ed88fe5` | claude/phase-a-ledger-continue-uzbbb5 | `288acd6` | **pre-isolation: production client config** |
| `b7927393-2331-4f12-852a-27c849d958cf` | claude/phase-a-ledger-continue-uzbbb5 | `0a4cbc8` | **pre-isolation: production client config** |
| `b077a068-e750-4338-a691-8320c9b86e43` | claude/phase-a-ledger-continue-uzbbb5 | `9b3ee06` | **pre-isolation: production client config** |
| `5bc8b920-ab51-4091-91cc-972357c58aee` | claude/phase-a-ledger-continue-uzbbb5 | `e499e47` | **pre-isolation: production client config** |
| `98904039-7b23-44ef-a678-d9430856eb8f` | perf/firestore-read-budget | `0608b6b` | **pre-isolation: production client config** |
| `8a8cd715-0ab4-48e5-ada8-b8637f0432ad` | claude/phase-a-ledger-continue-uzbbb5 | `e4d7544` | **pre-isolation: production client config** |
| `81f5aa95-558a-44f9-b022-e03c88977c50` | claude/phase-a-ledger-continue-uzbbb5 | `2f395c6` | **pre-isolation: production client config** |
| `581bc272-476a-4a8b-9d0d-cd27cfb8ce0c` | claude/phase-a-ledger-continue-uzbbb5 | `76d31a7` | **pre-isolation: production client config** |
| `060df407-ca4f-4228-ba7a-d88d304325d5` | claude/phase-a-ledger-continue-uzbbb5 | `a0b9391` | **pre-isolation: production client config** |
| `1c44462f-7c53-4662-94f9-0efa8ebd9a6b` | claude/phase-a-ledger-continue-uzbbb5 | `f3b26cb` | **pre-isolation: production client config** |

### A.3 Deletion: the exact commands (DELETE: owner only)

Run only after A.1. **Check that none of the ids is `614fcc13-e680-4a97-8662-3349c58360e6`
(production) or the rollback target `0d00ae76-2965-4dc7-898b-410b543049b5`.** Re-list right
before deleting: production moves with every push to `main`.

```bash
# DELETE: one pre-isolation preview per line; repeat for the ids found in A.1 older pages
npx wrangler pages deployment delete 6a06a8ef-d58f-4630-a0f2-40df37b11ba2 --project-name pzmstock --force
```

The full list for the newest page is in `docs/ops/preview-deletion-ids.txt`: the 24
pre-isolation preview ids, with production and the isolated preview excluded.

`--force` also removes a deployment that is the alias target of its branch. After that, the
alias stops serving the old build.

### A.4 After deletion: verify

- Every deleted hash URL returns 404 (re-run the probe in `firestore-read-investigation.md`).
- The branch aliases that still resolve are built from code containing `0261c48`. Their
  `/api/supplier/x` returns `preview_isolated`.
- **Preview environment** (dashboard → pzmstock → Settings → Variables and Secrets → Preview):
  - no `FIREBASE_SERVICE_ACCOUNT`;
  - no `SUPPLIER_LINK_SECRET`;
  - no `SUPABASE_DB_URL` / `service_role`;
  - a **separate low-quota** `GEMINI_API_KEY`, or none.
- **Bindings:** add an `[env.preview]` section to `wrangler.toml` that declares no KV or AI,
  or a separate preview KV. Deploy this **together** with the next production deploy, then
  check that production's `PO_IMAGES` is still bound.

---
## B. Cron Worker `pzmstock-cron`

### Deployed versus source (read-only, 8 Oct)

| Check | Deployed | Source (`worker/`, main `476fa35` and this branch) |
|---|---|---|
| Versions | 2 versions, both 7 Oct 10:48 UTC: `30fad7a2` "Upload" + `89ec70f8` "Secret Change" **2 s later**; nothing since | — |
| Handlers | **`fetch` only** (`wrangler versions view`) | `fetch` **and** `scheduled` (all of 04eaebb, 2a8d578, 476fa35; local `wrangler deploy --dry-run` bundle exports `async scheduled`) |
| Secrets | `FIREBASE_SERVICE_ACCOUNT` | needs it |
| `WORKER_ENABLED` | not visible on the version (plain vars come with a deploy) | `"true"` in `wrangler.toml` |
| Cron triggers | **not verifiable by CLI.** Live tail 14:50–15:15 ICT across the 15:00 `*/30` slot: **0 events** (not even an error) | main: 4 crons; this branch adds `15,45 * * * *` (shadow sync, idle without `SUPABASE_DB_URL`) |
| `meta/cronStatus.lastRunAt` | not read (that is a production read); expected **absent** | written at the end of every run |

**Root cause (high confidence).**
- `wrangler secret put` against a Worker that does not exist yet **creates a placeholder
  Worker**: a default script with a `fetch` handler and no triggers. It then stores the
  secret. That is exactly the "Upload, then Secret Change two seconds later" pair seen
  above.
- `supabase/README.md` tells the operator to run `npx wrangler secret put
  FIREBASE_SERVICE_ACCOUNT -c worker/wrangler.toml`.
- The shadow setup was being done at that hour (commits 17:24–18:00 ICT on 7 Oct; the
  upload was at 17:48 ICT).
- **So `npm run worker:deploy` has very likely never run.** No server-side cron has ever
  fired. The browser fallback (`shouldRunNotifications`) is what runs the jobs, on every open
  manager or admin device, every 30 minutes.

**Owner checks (dashboard, read-only):**
- Workers & Pages → `pzmstock-cron`:
  - **Triggers** tab: expect no cron triggers.
  - **Logs → Cron Events**: expect none.
  - **Deployments**: the script should show a "Hello World"-style default.
- Firestore console: `meta/cronStatus`. Expect it to be absent.

### What deploying it would cost (measured: `node scripts/worker-read-estimate.mjs`)

The run is in memory on a production-sized brand (460 products, 1,400 balances, 2,700
movements, 120 orders, 280 notifications). Billed reads count one per document returned, and
one per empty query.

| Job | Runs a day | Reads per run (steady) | Reads a day |
|---|---|---|---|
| `frequent` (`*/30`) | 48 | 6 | 288 |
| `morning` (07:00) | 1 | **4,029** | 4,029 |
| `generate` (00:05) | 1 | 3 | 3 |
| `weekly` (Mon 07:30) | 1/7 | 2,356 | 337 |
| **One production-sized brand** | | | **≈ 4,660** |
| An empty brand | | | ≈ 210 |
| **Three brands (upper bound)** | | | **≈ 14,000** |

- The real Pizza Mania is smaller than this fixture (336 products, 524 balances). Le Lapin is
  smaller still, and R&D is new (228 products).
- **Expected: about 6–8K reads a day** for the three brands.
- It **replaces** the browser fallback, which main's evidence puts at about 1K per open
  manager device a day. So the net change is **about +3–6K a day** on today's budget.
- **The `morning` job reads the whole brand.** That is the item to optimise (deltas)
  **before** deploying, if the budget is tight.

### Decision for the owner

1. **Leave as is.** The browser fallback keeps notifications working while a manager has the
   app open; nothing runs while nobody does. Cost: 0 extra.
2. **Deploy the Worker** (`npm run worker:deploy` from `main`, once approved):
   - jobs run on time even with every app closed;
   - **about +3–6K reads a day**;
   - check Triggers, then `meta/cronStatus` the next half hour.
3. **Optimise `morning` first** (delta reads), then deploy. This is a code change for a
   later batch.

**Not done:** nothing was redeployed or re-enabled.

---

## C. Firestore hourly metrics, 5–8 Oct

**The 6 Oct spike is an open incident.** About 70–80% of the about 690K reads are not
attributed (`docs/evidence/firestore-read-investigation.md`).

### The export

1. Google Cloud console → project `pzm-stock-x5` → **Monitoring → Metrics explorer**.
2. Set up the metric:
   - metric: **Firestore Database → `firestore.googleapis.com/document/read_ops_count`**;
   - **group by `type`** (QUERY / LOOKUP), plus `database`;
   - aligner **sum**, alignment period **1 hour**;
   - range **5 Oct 00:00 → 9 Oct 00:00 ICT** (UTC+7).
3. Export as **CSV** (⋮ → Download), and add it as `docs/evidence/data/firestore-reads-hourly-oct5-8.csv`.
4. Optional, for the same days:
   - `firestore.googleapis.com/network/active_connections`;
   - `firestore.googleapis.com/network/snapshot_listeners`.

### What each hour will be matched against (already collected)

| Signal | Source | Times (ICT) |
|---|---|---|
| Production deploys (PWA update → reload → re-listen) | `wrangler pages deployment list` | 5 Oct 22:23; **6 Oct 09:43, 10:10, 10:27, 10:49, 10:54, ≈23:42**; **8 Oct 14:00, 14:36** |
| Read-cost fix live (device copies; first full read per device) | `2a8d578` | 6 Oct ≈23:42 |
| Cache invalidations (epoch bumps) | restores only | owner: any restore on 5–8 Oct? |
| Worker events | none ever (§B) | — |
| Bulk scripts and backups | backups of 6 Oct 15:00 (both brands); **8 Oct: 228 R&D items + supplier links** (`476fa35`, how were they written?) | owner to confirm |
| Backfill jobs | shadow backfill reads **files**, 0 Firestore reads | — |
| Old production-connected previews | 24 reachable (§A) | unknown use |

The incident stays open until the hourly series, broken down by QUERY/LOOKUP, is matched.
Nothing in this document resolves it.
