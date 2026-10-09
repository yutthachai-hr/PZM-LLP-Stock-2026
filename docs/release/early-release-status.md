# Early release: status at the PR #2 owner gate (9 Oct 2026, evening)

## What changed since the first packet
- **PR #6 (request item notes) was merged into `main` at 15:11** (`ab51df9`, squash) and deployed to
  Production (`510dc53f`). Its squash also carried this line's CI files (identical copies).
- PR #2 was **behind** `main` (strict protection). `main` was merged into the foundation as a merge
  commit, with no force-push. **New PR #2 head: `3ad4228`.** Its diff against `main` is now preview
  isolation only (11 files).
- The #6 and #7 overlap in `ProductPicker.tsx` is reconciled: the item note and the no-unit refusal
  are kept together.
- **PR #8:** item note from the supplier tab too (follow-up to #6).
- **PR #3:** the "Cloud mode, data syncs in real time" line was removed from login (owner).
- **PR #7:** the dialogs e2e step now reopens the row menu if it closed while the list was settling.
  This was a timing flake: 2 of 4 tests failed per run on a loaded machine; now 3 of 3 runs are
  clean.

## Combined showcase regression (`showcase/early-release`)
| Check | Result |
|---|---|
| typecheck ×4, oxlint, i18n | pass, 0 lint errors |
| unit | 1,234 passed |
| rules | 217 passed |
| build + budget | main 2,916 KB / initial 3,426 KB (budget 2,950 / 3,450) |
| e2e (full suite incl. new `showcase-regression.spec.ts`) | **4 of 4 runs: 15 passed, 1 skipped** (the read benchmark needs a backup) |
| auth + brand switch + 3-brand separation | pass (Pizza search never shows Le Lapin items and the reverse) |
| smart supplier: auto pick, no silent switch, manual choice stands, PO lock | pass |
| global search: Ctrl+K, pages, Enter deep link | pass |
| alert during startup pops | pass; **the same test fails on `main`**, confirming the fix |
| no production hosts contacted (googleapis, firebaseio, pzmstock.pages.dev, Gemini) | pass |
| **Firestore reads, real Pizza Mania backup, 16 workflows** | **identical to `main`: diff 0 on every workflow; 7 listeners both** |

## Smart supplier: real mappings (local backups of 9 Oct 10:41, no new reads)
| Brand | Active products | Mapped | Stale supplier id | Bracket ≠ mapped supplier |
|---|---|---|---|---|
| Pizza Mania | 222 | 222 (100%) | 1 (SOUR CREAM (FOOD PROJECT)) | 23, all spelling (SIMUMMUANG/SIMMUMMUANG) except **STICKER-DIE-CUT 30x30 (MILLION POLY) → TOP MULTIPRINTS** |
| Le Lapin | 112 | 110 | 0 | 21, spelling |
| R&D | 228 | 221 | 0 | 1, spelling (FIYING/FLYING BOARD) |

- **SAUSAGE MIX DOLCE:**
  - In production, "SAUSAGE MIX DOLCE (LARDER)" maps to **LARDER** and "(FOOD WAY)" to FOOD WAY, as
    two separate products.
  - "LADER" was the demo catalogue's spelling.
- **The stale id resolves to nothing** (never invented): SOUR CREAM falls back to history or "no match".
- **Brackets are never evidence** (unit-tested). The sticker product would auto-fill TOP MULTIPRINTS
  from master data. Owner: confirm that mapping.
- **Alternates:** no real product has `alternateSupplierIds` yet, so the alternate paths are covered by
  unit tests only.
