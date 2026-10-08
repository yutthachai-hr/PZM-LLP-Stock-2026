# P0 Cloudflare Preview isolation: evidence

Branch `integration/ops-os-rc1`, on top of `69d7625`. Owner brief of 8 Oct 2026.
**Nothing was pushed, merged, or deployed.** This change takes effect only when a build of
this branch is deployed.

## The rule

| Deployment | Firebase project in the app | Privileged Pages Functions |
|---|---|---|
| `main`, on `pzmstock.pages.dev` | Production (unchanged) | Run (unchanged) |
| Any other branch: `demo`, feature branches, `integration/*`, `claude/*` | **None.** The build is a demo build, stored in the browser only. | **503 `preview_isolated`** |
| A `main` build opened on any other host (a deployment's hash URL, a copied bundle) | **None**, including a config saved in localStorage | **503** (decided by host) |
| A Pages build without `CF_PAGES_BRANCH` | **The build fails** ("refusing to guess") | n/a |
| Staging (opt-in) | n/a | Run only when `DEPLOY_TIER=staging` **and** every project it names (`FIREBASE_PROJECT_ID`, the service account's `project_id`) is not `pzm-stock-x5` |

The rule is decided in one place, `src/lib/deployTier.ts`. It is pure code and runs in the
build, the browser and the Workers runtime. There are three layers, and none of them depends
on another:

1. **Build** (`vite.config.ts`). `buildTier(CF_PAGES, CF_PAGES_BRANCH)` decides the tier.
   - Only `main` produces a production build; every other branch builds with
     `VITE_DEMO_MODE=1`.
   - A missing branch is an error.
   - Before this change, only the `demo` branch was isolated. **Every other preview shipped the
     production client config.**
2. **App** (`src/firebase/config.ts`). A production build returns no config unless
   `location.hostname` is the production host. This runs before `BUILT_IN`, and before the
   config saved in this browser.
3. **Functions** (`functions/{api,a,po}/_middleware.ts` → `functions/_lib/previewGuard.ts`).
   - The guard decides by the request's host and runs before any handler.
   - It does not trust the client, and does not trust a build flag.
   - Only `/api/client-error` stays open in preview, because it logs only and reads no secret
     or binding.

## Tests

### Automated: `tests/preview-isolation.test.ts`, 20 tests, all pass

- **Build tier:**
  - `main` → production;
  - `demo`, `Main`, `main2`, `refs/heads/main` and feature branches → preview;
  - a missing or blank branch throws.
- **Host tier:**
  - only the exact production host counts (case and a trailing dot are tolerated);
  - preview aliases, hash URLs, look-alike hosts (`pzmstock.pages.dev.evil.com`,
    `evilpzmstock.pages.dev`) and unknown hosts are all preview;
  - a custom domain can be added, but a `*.pages.dev` alias never can.
- **Function tier:** staging is refused when any named project is production, when no project
  is named, or when the service account is not valid JSON.
- **Every route on disk:** the test lists `functions/**`, and fails if a new route appears
  that is not in the known list.
  - Every top-level route folder must have a `_middleware.ts` that **is** the guard.
  - For each privileged route × 5 non-production hosts (with a production service account in
    the env): status 503, body `preview_isolated`, and **the handler was not called**.
  - On the production host, the handler is called.
- **App config:**
  - a preview (demo) build with a production config saved in localStorage → `null`;
  - a production build on a hash URL or a foreign host → `null`;
  - a production build on `pzmstock.pages.dev` → `pzm-stock-x5`, unchanged.

### Direct HTTP: a real preview build under the Pages runtime

Built with `CF_PAGES=1 CF_PAGES_BRANCH=integration/ops-os-rc1`. Served with
`wrangler pages dev`, which runs the real Functions and middleware.

| Request | Result |
|---|---|
| `POST /api/stock/receivePO`, `POST /api/stock/adjust` | 503 `preview_isolated` |
| `POST /api/ocr-bill` | 503 |
| `GET /api/po-image?k=x`, `POST /api/po-image` | 503 |
| `GET` / `POST /api/supplier/abc` | 503 |
| `POST /api/supplier-po/decide`, `POST /api/supplier-po/link` | 503 |
| `GET /a/abc`, `GET /po/abc` | 503 |
| `POST /api/client-error` (empty body) | 400 from the handler (expected: allowed, validates its input) |

A notification or Worker endpoint is not on this list because there is none. The cron Worker
(`pzmstock-cron`) is a separate Worker with no HTTP route in Pages, and it has no preview
deployments.

### Browser: network interception, built-in browser

| Case | Saved in localStorage | Requests outside the page's own origin | Screen |
|---|---|---|---|
| Preview build (above) | a production config (`projectId: pzm-stock-x5`) | **0** of 50. No googleapis, firebase, identitytoolkit or gstatic. | Demo sign-up, with the demo banner |
| `main` build served on `127.0.0.1` | the same | **0** of 50 | Local mode ("data stays in this browser") |

### Live: the real Cloudflare preview of this branch (after the owner's push of `0261c48`)

Host: `integration-ops-os-rc1.pzmstock.pages.dev`, built by Cloudflare from this branch.

| Request | Result |
|---|---|
| `POST /api/stock/receivePO`, `POST /api/ocr-bill`, `GET /api/po-image`, `GET /api/supplier/abc`, `POST /api/supplier-po/decide`, `POST /api/supplier-po/link`, `GET /a/abc`, `GET /po/abc` | **503 `preview_isolated`**, `x-pzm-tier: preview` |
| `POST /api/client-error` | 400 (allowed; the handler validates its input) |
| `Host: pzmstock.pages.dev` sent to the preview URL | 405 (shown by the missing `preview_isolated` body), so the edge routed it elsewhere and the preview's handler was not reached |
| Browser, with a production config saved in localStorage | **0** external requests of 50; local or demo sign-up screen |

### Fail closed

`CF_PAGES=1` with no branch makes `vite build` exit 1, with the message "refusing to guess the
deployment tier". This was checked earlier in this session.

### Limitation: Host spoofing under the local dev server

Under `wrangler pages dev`, `Host: pzmstock.pages.dev` passes the guard (the handler then
answered `not_configured`, because there is no secret locally). This is a property of the dev
server, which builds the URL from the Host header. **On Cloudflare's edge it does not apply:**
a request for `pzmstock.pages.dev` is routed to the production deployment, so a preview's code
never receives it. Layer 4 below (preview secrets) is the defence that does not rely on routing.

## Audit of the live Cloudflare project (read-only, `wrangler`, 8 Oct)

- **Production** serves deployment `dbee8792` = commit `2a8d578`. On 6 Oct, production also
  received `7e5965e` and `c66f77d`; these feed the read investigation.
- **25 preview deployments** exist:
  - 22 from `claude/phase-a-ledger-continue-uzbbb5`;
  - the rest from `perf/firestore-read-budget`, `feat/outbox` and `bench/read-compare`.

  Every one ships the production client config (`BUILT_IN`). **Each is a production-connected
  app at its own URL**: anyone signed in can read and write live data through it, under the
  rules, with that build's (unreleased) code.
- **Production secrets (names only):** `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`,
  `SUPABASE_DB_URL`, `SUPPLIER_LINK_SECRET`, `service_role`.
- **Preview secrets:** `GEMINI_API_KEY`, `PO_IMAGE_DEMO_KEY`, `VITE_PO_IMAGE_DEMO_KEY`.
  - **No service account in preview**: old previews' `/api/stock/*` and supplier endpoints
    answer `not_configured`.
  - But preview's Gemini key, and the **shared** `PO_IMAGES` KV and `AI` binding, are live.
- **Bindings:** `wrangler.toml` declares the `PO_IMAGES` KV and the `AI` binding at the top
  level, with no `[env.preview]`. **Previews share production's KV namespace**: an old preview
  can read and overwrite order-sheet images that LINE links point at.

## What this patch does not do: owner actions in the Cloudflare dashboard

These cannot be done from the repository without deploying or changing account settings, so
they were not done.

1. **Delete the 25 old preview deployments.** Each is a production-connected client that this
   patch cannot change, because they are already built. The production deployment `dbee8792`
   must be kept.
2. **Give preview its own bindings, or none.** Either:
   - add an `[env.preview]` section to `wrangler.toml` that declares no KV or AI (bindings are
     not inherited), or
   - point it at a separate preview KV namespace.

   This is a deploy-time change. Do it together with the next production deploy, and verify
   production's `PO_IMAGES` is still bound afterwards.
3. **Separate the Gemini key.** Preview should use its own low-quota key, or none.
   `/api/ocr-bill` is now refused in preview anyway.
4. **Production secrets to review:**
   - `SUPABASE_DB_URL` and `service_role` are set on Pages production, but no Pages Function
     reads them. Only the Worker needs the database URL.
   - Remove them from Pages unless a planned function needs them, to keep the blast radius
     small.
5. **Optionally**, turn off automatic preview deployments for branches that do not need a URL
   (Settings → Builds → Preview branch control). Fewer previews means fewer stale bundles.
6. **Staging**, when wanted: a separate Firebase project and service account, set as preview
   secrets on one branch with `DEPLOY_TIER=staging` and `FIREBASE_PROJECT_ID=<staging>`. The
   guard refuses it if either names `pzm-stock-x5`. The app side of staging (a staging client
   config) is not built yet; today a staging preview's app runs in demo mode.

## Behaviour changes to be aware of

- The public **`demo` branch** behaves as before (demo mode). Its supplier and LINE share
  links (`/a/*`, `/po/*`, `/api/po-image`) now answer 503 there, where before they read the
  shared KV. In demo mode these links are not generated from live data.
- A `main` build opened at its hash URL (for example `dbee8792.pzmstock.pages.dev`) now shows
  local mode instead of production. Support staff must use `pzmstock.pages.dev`.
- **A custom production domain**, if one is added later, must be listed in **both** places:
  - `PRODUCTION_HOSTS` in `deployTier.ts` (for the app);
  - the `PRODUCTION_HOSTS` variable (for the functions).

  Otherwise the domain fails closed.
