# Old Preview cleanup: evidence (owner decision 1, 8–9 Oct 2026)

**Done:** 113 Preview deployments deleted, 0 failures. The IDs are in
`docs/ops/preview-deletion-ids.txt`.

**Rule.** Each deployment was validated one at a time, live:
- it must be a `Preview`;
- it must not be on the keep list;
- it must be **proven** pre-isolation: an isolated build answers `preview_isolated` on
  **every** `/api/*` path (checked on `e2bd3503`); anything else has no guard. Two failed
  builds (served nothing) were also removed.

**Never touched:** all 23 Production deployments, including current `614fcc13` (`ad43971`)
and rollback `0d00ae76`.

| Pass | Source of IDs | Deleted |
|---|---|---|
| 1 | Owner-approved list (`preview-deletion-ids.txt`), re-validated | 19 |
| 2 | Next page of the same branch (validated live) | 19 |
| 3–5 | Other branches and older `demo` builds, through the preview-only listing | 75 |

**By branch (passes 3–5):**

| Branch | Deleted |
|---|---|
| `demo` (older builds) | 50 |
| `feat/inventory-calendar` | 8 |
| `feat/monthly-count` | 4 |
| `feat/login-mascots` | 3 |
| `fix/po-number-colour`, `fix/po-history`, `fix/po-batch-review`, `fix/import-review`, `feat/purchase-requests`, `feat/phase-a-ledger`, `feat/integrity-auditor`, `feat/count-as-of`, `claude/phase-a-ledger-continue-uzbbb5`, `chore/cloudflare-cutover` | 1 each |

## What is left, and why

| Preview | State | Why kept |
|---|---|---|
| `e2bd3503` / alias `integration-ops-os-rc1` | Isolated (`preview_isolated`; demo data) | Safe by construction |
| `0f5a6de5` / alias `demo` | **The public demo site** (owner's). Demo-mode client (browser storage), but its functions predate the isolation guard. | A product decision. Rebuilding `demo` from a branch that contains `0261c48` gives it the guard (owner). |

**Still answering, though deleted (re-checked 9 Oct 00:00 ICT):**
- Some deleted hash URLs, for example `91f2fc7d`, `98904039` and `88d7433e`.
- Two aliases with no remaining deployment: `feat-outbox`, `perf-firestore-read-budget`.

Cloudflare no longer lists any of them, so this is the edge serving deleted content.
`wrangler` cannot purge it. They are **sign-in pages**: the production-connected client
reads nothing until someone signs in.

Aliases now **404**: `feat-login-mascots`, `fix-import-review`, `claude-phase-a-ledger-cont`,
`bench-read-compare`.

## Owner steps that remain

1. **Restrict preview access now** (Decision 1, "temporarily restrict"):
   - Cloudflare dashboard → Workers & Pages → `pzmstock` → Settings → General →
     **Access policy: Enable for preview deployments**.
   - This puts every `*.pzmstock.pages.dev` preview, including the stale ones above,
     behind Cloudflare Access.
   - Production (`pzmstock.pages.dev`) is not affected.
2. **Bindings:** previews still share production's `PO_IMAGES` KV and `AI` binding
   (`wrangler.toml` has no `[env.preview]`), and the Preview `GEMINI_API_KEY`. Isolated
   builds refuse those routes, but the stale and demo builds do not. Give Preview its own
   KV and key, or remove them.
3. **Custom domains:** none on the project (`wrangler pages project list`: only
   `pzmstock.pages.dev`).
4. **Do not push `feat/login-mascots` as it is.** It lacks the isolation code, so its
   preview would be production-connected again. Merge the RC (or `main` after it) into it
   first.

## Update, 9 Oct 2026: previews behind Cloudflare Access

**Done:**
- **Pages → pzmstock → Settings → General → Preview access → Restrict previews**: done at the
  owner's request.
- Cloudflare created the Access application with destination `*.pzmstock.pages.dev` and policy
  "Allow Members - Cloudflare Pages" (account members only), with 24-hour sessions.
- The owner separated preview variables and secrets from production.

**Re-probed from outside, unauthenticated:**

| Target | Result |
|---|---|
| Old deployments `91f2fc7d`, `98904039`, `88d7433e` | Page and `/api/*` → **302 to the Access login** |
| Aliases `feat-outbox`, `perf-firestore-read-budget` | **302** |
| Kept previews `0f5a6de5` (demo), `e2bd3503` | **302** |
| Branch previews `exp-real-stack`, `rc-ops-os-rc1-candidate` | **302** |
| **Production `pzmstock.pages.dev`** | **200**, unaffected: the policy covers subdomains only |

**Consequence:** the public demo preview now requires an account-member login too. If the demo
must be public again, add a Bypass policy for that one hostname. It is an owner decision, and
safe only because the demo runs on demo data with no keys.
