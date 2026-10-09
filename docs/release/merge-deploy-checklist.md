# Merge / deploy approval checklist: PR #1 → `main` → production

**Merging `main` deploys the app automatically** (Cloudflare Pages builds `main` to production).
So the transition rules go live and are validated **before** the merge, not after. Nothing on
this list has been done. Each box is ticked by the owner, or by Claude on the owner's word, and
the final merge is the owner's alone.

Runbook detail for each step: `docs/release/deployment-runbook.md`.

## A. Before anything changes

- [ ] **Final SHA recorded:** the PR head to be merged = `________`. Every check below is on this
  SHA. A new commit restarts the list.
- [ ] **CI green on that SHA:** all 9 required checks (typecheck, lint-i18n, unit, agent-safety,
  rust, rules, build-budget, e2e, secrets). Branch protection enforces it; admins included,
  nothing bypassed.
- [ ] **Local release gates on that SHA** (clean checkout): `npm run verify` PASS, and e2e ×3 with
  no retries PASS.
- [ ] **Backups**, one per brand (Pizza Mania, Le Lapin, R&D), stored off the machine. Each
  `integrity-audit` PASS.
- [ ] **Restore drill** run once into an **isolated** Firebase project from those backups, then
  `integrity-audit` PASS on the restored copy. *Not yet possible: no isolated project exists. See
  the RC Go/No-Go, item "Restore rehearsal".*
- [ ] **Read baseline** taken: Cloud Monitoring, hourly, 3 days (`docs/evidence/data` method).
- [ ] **Live rules saved** as `rules.prod.bak`, and identical to `origin/main:firestore.rules`.
- [ ] **Live indexes** = `firestore.indexes.json` (6 = 6 on 8 Oct; check again).
- [ ] **Pages production variables:** no new flags set. Unset:
  - `VITE_SHADOW_SEED`
  - `VITE_ASK_PZM`
  - `OUTBOX_ENABLED`
  - `ASK_PZM_ENABLED`
  - `DEPLOY_TIER`

## B. Transition rules: deploy and validate BEFORE the merge

- [ ] Point `firebase.json` at `firestore.transition.rules` and deploy rules only:
  `npx firebase deploy --only firestore:rules --project pzm-stock-x5`.
- [ ] **The current production app (`614fcc13`, which sends no version) still works:** edit one
  product's unit rate, file one request, receive one PO line, all on a test product.
- [ ] **New-app behaviour proven on the emulator:** version +1 accepted
  (`tests/rules-transition.test.ts`).
- [ ] No `permission-denied` in `/api/client-error` for 30 minutes after the rules deploy.
- [ ] **Rollback rehearsed:** redeploy `rules.prod.bak`, confirm, then redeploy the transition
  rules.

## C. The merge (owner only)

- [ ] Owner's written approval in chat: "merge PR #1 at `<SHA>`".
- [ ] Merge through the PR. Branch protection requires it, so no direct push.
- [ ] Pages production deployment of that SHA is **Success**. Record the new deployment id.

## D. After the deploy

- [ ] Runbook §5: critical workflows, one brand at a time.
- [ ] Runbook §6: old clients gone by **evidence**, not hours. Zero stock commands without the new
  `x-pzm-build` for a full working day.
- [ ] Only then the **strict G25 rules** (runbook §7).
- [ ] Runbook §8: monitor for 3 days (reads, errors, ledger, PO, receipts, transfers).

## E. Rollback triggers (any one means roll back now)

| Trigger | Action |
|---|---|
| A workflow in §5 fails | Pages → rollback to `614fcc13`. The transition rules accept it. |
| `permission-denied` on product or order writes | Redeploy the transition rules (if strict), or `rules.prod.bak` after the app rollback |
| Reads above 40K for any day, or an hour above 1.5× baseline | Find the source before anything else ships |
| Integrity audit not PASS | Freeze writes, restore drill path |

## Not part of this release (separate owner gates)

- Cron Worker activation.
- Supabase project or cutover.
- Ask PZM anywhere but staging.
- AI gateway.
- Model routing.
