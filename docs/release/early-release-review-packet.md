# Early Feature Release: PR review packet (9 Oct 2026, updated evening)

> **Superseded figures:** see `docs/release/early-release-status.md` for the current SHAs,
> the #6 merge and the combined regression. Tables below are the first version.

**Nothing here is merged.** `main` deploys to Production, so every merge needs the owner's
separate, explicit approval of one exact PR and SHA.

**Showcase (all features together, demo data, behind Access):**
<https://showcase-early-release.pzmstock.pages.dev>
- Branch `showcase/early-release` @ `922d29e`, never for merging.
- Unit 1,233 · bundle 2,915 / 3,425 KB (budget 2,950 / 3,450).

## The PRs

| PR | Branch @ SHA | What | CI (9 required) | Preview |
|---|---|---|---|---|
| #2 | `feat/release-foundation` @ `c95334b` | Phase 0: CI, gitleaks, no-regression bundle budget | **9/9 green** | feat-release-foundation.pzmstock.pages.dev |
| #3 | `feat/release-login` @ `2722231` | Phase 1: login scenes, Jakarta + Anuphan (login only), playful brand switch | **9/9 green** | feat-release-login.pzmstock.pages.dev |
| #4 | `feat/release-supplier` @ `1dcb9cd` | Phase 2: smart supplier resolution on receiving | **9/9 green** | feat-release-supplier.pzmstock.pages.dev |
| #5 | `feat/release-search` @ `34ebdfa` | Phase 3: grouped global search (Ctrl/Cmd+K) | **9/9 green** | feat-release-search.pzmstock.pages.dev |
| #7 | `feat/release-ux` @ `29a2c50` | Phase 4: stacked-dialog Escape, notification race, import guesses, unknown units | **9/9 green** | feat-release-ux.pzmstock.pages.dev |

- #3, #4, #5 and #7 are stacked on #2 and independent of each other.
- When #2 merges, each is retargeted to `main` and CI re-runs.

### What each PR touches

| | #2 | #3 | #4 | #5 | #7 |
|---|---|---|---|---|---|
| Firestore Rules / indexes / schema / transactions | no | no | no | no | no |
| New Firestore reads or listeners | no | no | **no** (in-memory data) | **no** (in-memory; suppliers only if already loaded) | no |
| New writes | no | no | no (localStorage only) | no | no |
| New npm dependencies | no | no (self-hosted fonts, +45 KB) | no | no | no |
| Changes daily operations | no | login page look only | **yes:** supplier pre-filled when unambiguous | top-bar search | **yes:** import is stricter |
| Rollback | revert | revert | revert (old drafts compatible) | revert | revert, or one commit |

### Not carried from the RC (on purpose)
- G25, `operationId`, the outbox, `ledgerTx` `requireMasterData`.
- The Supabase migration, Cron, AI, Goose.
- The axe dependency, and RC-only strings.

### Known flakiness (exists on `main`, not from these PRs)
`e2e/receive-po.spec.ts` "two devices confirm the same delivery at once" is `test.fail`
(audit D1). If the two devices happen not to race, that test passes, and Playwright reports
the unexpected pass as a failure. Seen once in local runs; CI was green.

## Owner decisions needed
1. **CI on this line:** the agent-safety and rust jobs verify the code is absent (report "N/A").
   - Accept them as required checks as they are, **or**
   - remove those two from the required checks on `main` until that code ships.
2. **Merge #2 first** (exact SHA `c95334b`). It adds CI and scripts only, with no runtime change to
   the app, so production behaviour is unchanged.
3. Then, one at a time, each with its own approval. Suggested order:
   - **#7** (fixes);
   - **#3** (login);
   - **#5** (search);
   - **#4** (supplier, which changes the daily receiving routine, so brief the staff first).

## Gaps documented (not hidden)
- **Global search** finds purchase requests and transfers only on their own pages: there is no
  in-memory source, so searching them from the top bar would need new reads. Documents are limited
  to the loaded movement window, and the footer says so.
- **Smart supplier:** feedback stays on the device until a shared collection is approved. The
  "จาก PO-…" ("from PO-…") label was not exercised in the demo, which has no open PO; unit tests
  cover it.
