# R64 Agent07 Backlog Cleanup & Feature Extraction Report

- **Date:** 2026-10-24
- **Agent Assignment:** R64 Agent07 (Backlog Cleanup & Feature Extraction)
- **Worktree:** `C:/Users/Yutthachai/.t3/worktrees/PZM-LLP-Stock-2026/t3-484f9517` (isolated worktree)
- **Branch:** `t3/r64-backlog-feature-extraction`
- **Base Commit:** `origin/main` at `312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55`
- **Active Provider / Model:** `opencode` / `9router/gemini-3.8-flash-high`
- **Execution Constraints Enforced:**
  - Dedicated isolated worktree only (`t3-484f9517`).
  - No nested agent / subagent spawning or forbidden fallback models.
  - No production deploy, no Rules deploy, no main merge, no remote push.
  - No activation of PR 46; no merge of giant PR 1 RC candidate.
  - Uncommitted root owner policies (`AGENTS.md`, `PROGRESS.md`, etc.) preserved untouched.
  - Implementation status: `REVIEW_PENDING` (independent review required; no self-approval).

---

## 1. Backlog Closure & Extraction Matrix

| Target | Head SHA | Base vs Main | Unique Commits / Files | Dependencies & Overlaps | Status / Verdict |
|---|---|---|---|---|---|
| **PR 24** (`feat/smart-import-dnd`) | `330e3129e7f4dd2982d0f85ba154feac9baf833b` | Forked at `6924363` (old base) | 7 feature commits; `src/lib/importFile.ts`, `tests/import-file.test.ts`, `src/lib/itemText.ts`, `tests/item-text.test.ts`, `src/components/import/LineImportWindow.tsx`, e2e demo & fixtures | Overlaps PR 39 (OCR resilience). Full `LineImportWindow` replaces `LineImportModal` with conflicting UI | **EXTRACTED_PARTIAL / FIX_REQUIRED**.<br>Extracted bounded drop-file routing plumbing (`src/lib/importFile.ts`, `tests/import-file.test.ts`, drag-drop in `LineImportModal.tsx`, `billOcr.ts`). Retain PR 24 until remaining UI/text-parser is adapted or superseded. Do NOT close without proof. |
| **PR 19** (`fix/20261014-line-en-th`) | `aee096864282d44e1e72b6d13f627b1cff6a2e28` | Forked at `af0136b` (old base) | 3 feature commits; `e2e/localization.spec.ts`, `public/brand/line/*.png`, `scripts/i18n-audit.mjs`, `tests/i18n-audit.test.ts`, `tests/line-button-i18n.test.ts`, `tests/sidebar-activity-i18n.test.ts`, dashboard card copy | Coupled to LINE PWA refactors in PR 52 (PO reliability) and PR 53 (SW cache fix). Do not merge assets alone to inflate count | **FIX_REQUIRED / HOLD**.<br>Retain until PR 52/53 stabilize and real phone tests complete. |
| **PR 1** (`rc/ops-os-rc1-candidate`) | `4898dbbf66a8a5a2c6e3e52e724824074b4c5ed6` | Historical candidate (80+ commits) | Giant RC branch. Contains unique slices: Rust Integrity crate (`crates/pzm-integrity`), G25 Optimistic Concurrency Rules, Phase G Agent Safety harness (`G11-G17`), Smart "Other" | Main already has preview isolation, secrets handling, import safety, core transaction boundaries | **OUTLINE_SLICES_ONLY / DO NOT MERGE**.<br>Giant RC must NEVER be merged in bulk. Slice into standalone PRs when needed. |
| **PR 45** (`chore/20261022-matt-skills`) | `3fe883f24c082faf2ceb9e24022e6a8414a15bba` | Base is current `origin/main` (`312f8a7`) | 5 docs commits; `AGENTS.md`, `docs/agents/*`, `docs/mission/r61/r62/r63` | Docs only; policy reviewed & approved at `f38e317`. Owner R43 backup exists | **READY_FOR_OWNER_RELEASE**.<br>Docs-only, no autoMerge. Requires explicit Owner approval before merging. |
| **PR 46** (`r31/r25-bounded-batching`) | `0f7d035fc518fbed60c41a5053f5400e8913d9b8` | Base is current `origin/main` (`312f8a7`) | 11 commits; experimental R25 receiving, bounded atomic REST reads (`functions/api/receive-other.ts`, `receivePlan.ts`, `Receive.tsx`) | Experimental Rules and bounded batching not released | **OWNER_HOLD**.<br>Strict constraint: Do not activate PR 46. |
| **Target A2** (Partial Worktree `t3-abb9af93`) | Uncommitted working state | Backup at `docs/mission/r62/a2-502-backup` | 6 tracked modified files + 1 untracked file (`functions/api/supplier-po/requested.ts`), 0 commits | Core 126 tests pass, but `markSupplierRequested` has NO callers; `SendWizard` and `SupplierConfirmationPanel` not wired; revision validation needs security review | **HOLD (READ-ONLY)**.<br>Do not edit `t3-abb9af93`. Do not pretend done. Full feature remains on HOLD until scope coordination. |

---

## 2. PR 1 Feature Slices Breakdown

PR 1 is an obsolete giant RC candidate with 80+ commits. It must never be merged directly. Its unique features are segmented into clear, bounded slices:

1. **Slice 1: Rust Integrity Crate (`crates/pzm-integrity`)**
   - *Contents:* Rust-based integrity calculation crate checked against TypeScript reference implementation (`feat(integrity): G13`), TS↔Rust differential tests on random snapshots.
   - *Status:* Research/hardening artifact. Current TypeScript implementation on `main` is deterministic and passing. Defer until multi-language backend requirements arise.
2. **Slice 2: G25 Optimistic Concurrency Rules & Contracts**
   - *Contents:* Versioned contracts and optimistic concurrency rules on products and purchase orders (`feat(g25): optimistic concurrency on products and purchase orders`).
   - *Status:* Candidate for standalone feature extraction once PR 33 concurrency baseline is fully settled.
3. **Slice 3: Phase G Agent Safety / Laya System-1 Harness & Benchmark**
   - *Contents:* `G11` ActionProposal contract, `G12` Business Guard snapshot, `G15/G16` seeded safety attack benchmark, `G17` harness.
   - *Status:* Kept in reserve. Current repo uses deterministic policies and T3 orchestrator boundaries.
4. **Slice 4: Smart "Other" Item Resolution**
   - *Contents:* Type-ahead for ad-hoc items, code reuse/generation without invalid SKUs (`feat(rnd): Smart "Other" item`).
   - *Status:* Closely coupled to PR 46 (R25 bounded receiving). Remains on HOLD.

---

## 3. Extracted Feature: PR 24 Drop-File UX Plumbing

As requested, the smallest genuine standalone missing PR 24 feature was extracted atop current `main`:

### Scope of Extraction
- Extracted `src/lib/importFile.ts`:
  - Canonical constants: `MAX_PDF_BYTES = 2_900_000`, `MAX_SHEET_BYTES = 10_000_000`, `MAX_IMAGE_BYTES = 10_000_000`.
  - Pure function `routeImportFile(file, options)`:
    - Pre-flight routing to `'sheet'` (Excel, CSV) or `'document'` (PDF, images) before memory decoding or network calls.
    - Fail-closed validation for size caps, empty files (`0` bytes), busy states, and unconfigured document readers.
    - Robust MIME/extension fallback for empty MIME types and `application/octet-stream` with supported image extensions (`.jpg`, `.jpeg`, `.png`, `.webp`).
- Integrated into `src/services/billOcr.ts`:
  - Replaced duplicate `MAX_PDF_BYTES` constant with import from `src/lib/importFile.ts`.
  - Harmonized format validation in `readDocumentFile` with extension fallback for empty/generic MIME types.
- Integrated into `src/components/import/LineImportModal.tsx`:
  - Added drag-and-drop listener (`onDragOver`, `onDrop`) to the pick screen.
  - Routed dropped and picked files through `routeImportFile` before triggering sheet parsing or OCR reading.
- Localized error messages in `src/i18n/en.ts` and verified with `npm run i18n:check`.

### TDD Verification Evidence
- **RED Step:**
  - Wrote test suite `tests/import-file.test.ts` covering 9 behaviors.
  - Ran `npx vitest run tests/import-file.test.ts` against minimal stub.
  - **Result:** 9 failed tests with exact expected assertions.
- **GREEN Step:**
  - Implemented `src/lib/importFile.ts`, updated `src/services/billOcr.ts`, `LineImportModal.tsx`, and `en.ts`.
  - Ran `npx vitest run tests/import-file.test.ts tests/bill-ocr.test.ts`.
  - **Result:** 2 test files, 16 tests passed.
- **Full Verification Suite:**
  - Unit tests: `npx vitest run` -> **142 test files passed, 1723 tests passed** (clean run).
  - Typecheck: `npx tsc -b` -> **0 errors**.
  - Linter: `npx oxlint` -> **0 errors** (warnings only).
  - Localization check: `npm run i18n:check` -> **✓ every Thai UI string is translated**.
  - Production build: `npm run build` -> **vite build passed** in 1.68s.
  - Bundle budget: `npm run check:bundle` -> **✓ within budget** (main 239 KB).

---

## 4. Audit of MAIN Decision Trail (`docs/mission/r64/decisions.tsv`)

The append-only canonical decision trail at `C:/Users/Yutthachai/PZM-LLP-Stock-2026/docs/mission/r64/decisions.tsv` was audited in read-only mode against pointed artifacts and git history:

| Row / Timestamp | Phase | Decision & Claimed Evidence | Audit Finding |
|---|---|---|---|
| Row 2 (09:16:00Z) | R64 scheduling | Start Agent01 & Agent03 on Gemini; T3 clientRequestIds `r64-agent01-round1`, `r64-agent03-round1` | **VERIFIED** — Corresponds to recorded tasks in `usage.json` and `R64-SEVEN-AGENT-SPRINT.md`. Approximate timestamp superseded by Row 8. |
| Row 3 (09:18:14Z) | R61-B auth | Use existing Firebase CLI auth; GET APIs; `live-rules/metadata.json` | **VERIFIED** — `metadata.json` exists, valid fetch timestamp `2026-10-24T09:18:14.826Z`, release ruleset `80b1cd17-4388-4d49-8b91-31b58ed459a7`. |
| Row 4 (09:19:00Z) | R61-B candidate | Extract PR54 exact Rules blob; `comparison.json`, `candidate/firestore.rules` | **VERIFIED** — `candidate/firestore.rules` exists; SHA256 matches `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270`. |
| Row 5 (09:20:00Z) | R61-B comparison | Normalize line endings CRLF/LF; `comparison.json`, `live-rules/0-firestore.rules` | **VERIFIED** — Raw backup preserved; normalized comparison proves main equals live minus comments/validLocation. |
| Row 6 (09:22:00Z) | Production identity | Read static assets; `production-project-evidence.json` | **VERIFIED** — `pzm-stock-x5` identified from static JS asset; no authenticated app startup. |
| Row 7 (09:24:00Z) | PR54 tests | Rerun full Rules suite on exact PR54 HEAD; `pr54-rules-exact-head.log` | **VERIFIED** — Log confirms 251 of 251 tests passed. |
| Row 8 (09:23:42Z) | Audit Checkpoint | Initial 6 rows had approximate timestamps superseded by recorded checkpoint | **VERIFIED** — Explicit self-correction recorded in canonical trail; no history falsification. |
| Row 9 (09:26:42Z) | Live Rules reproduction | Replay live source in emulator; `live-rules-transit-red.log` | **VERIFIED** — Log confirms RED: 9 failed, 5 passed. Confirms deployed defect in emulator only. |
| Row 10 (09:26:43Z) | Rollback preparation | Raw live Rules in independent rollback dir; `verify-rules-package.cjs` | **VERIFIED** — `node verify-rules-package.cjs` executed and returned PASS. |
| Row 11 (09:38:49Z) | Agent01 complete | PR54 security review APPROVE; commit `433804d` | **VERIFIED** — Commit `433804d` exists; security package ready for Owner approval. |
| Row 12 (09:38:49Z) | Agent03 integration | Regressions `f301f39` into PR55; logs `notification-boundary-red.log` & `green.log` | **VERIFIED** — RED log shows 2 failed; GREEN log shows 102 passed; commit `f301f39` exists on PR55. |
| Row 13 (09:38:49Z) | Manual scheduler | Start Agent04 then Agent05; hosted limit <= 2 | **VERIFIED** — Concurrency limit maintained. |
| Row 14 (09:42:31Z) | PR33 cleanup | Retarget PR33 to main; PR33 head `7c0505d` | **VERIFIED** — Base branch retargeted cleanly without code mutation. |
| Row 15 (09:43:29Z) | Agent04 failed | Agent04 failed HTTP502; start Agent02 | **VERIFIED** — No forbidden fallback attempted; slot reassigned cleanly. |
| Row 16 (09:48:20Z) | Agent05 complete | Accept software verification only; report commit `569d2c8` | **VERIFIED** — Commit `569d2c8` exists in git; physical hardware hold maintained. |
| Row 17 (09:48:20Z) | PR55 preview | Verify `f301f39` Preview; `notification-preview-f301f39.json` | **VERIFIED** — HTTP 200 on preview deployment `d0b7e87f`, TR-00001 navigation verified, stock unchanged. |
| Row 18 (09:53:29Z) | Agent02 complete | LINE/PWA report `39f722e`; start Agent07 in freed slot | **VERIFIED** — Commit `39f722e` exists in git; freed slot used for Agent07. |

### Audit Summary
- **Unsupported Claims:** None found.
- **Timestamp Integrity:** Handled transparently by Row 8 checkpoint; initial 6 timestamp estimates are explicitly documented as superseded.
- **Unsafe Proposals:** None found. Emulator-only testing was strictly enforced; zero production writes occurred. All releases remain gated on explicit Owner approval.

---

## 5. Skills Followed & Reporting

- **`test-driven-development` (`test-driven-development/SKILL.md`):** Loaded and followed. Wrote failing test in `tests/import-file.test.ts`, verified 9 failures, implemented minimal code in `src/lib/importFile.ts`, and verified all 9 tests passed.
- **`ponytail` (full):** Followed throughout. Reused existing helpers and standard language features, minimized diff, and avoided premature abstraction.
- **`verification-before-completion`:** Executed full verification suite (`tsc -b`, `oxlint`, `vitest run`, `build`, `check:bundle`, `i18n:check`) before committing.

---

## 6. Local Git Status & Open Blockers

- **Local Worktree:** `C:/Users/Yutthachai/.t3/worktrees/PZM-LLP-Stock-2026/t3-484f9517`
- **Branch:** `t3/r64-backlog-feature-extraction`
- **Ready for Commit:** Extracted drop-file UX plumbing (`src/lib/importFile.ts`, `tests/import-file.test.ts`, `LineImportModal.tsx`, `billOcr.ts`, `en.ts`) and backlog matrix report (`docs/mission/r64/agent07-backlog.md`).
- **Open Blockers:**
  - Gemini implementation status is `REVIEW_PENDING` (must be reviewed by an independent model family; no self-approval).
  - PR 46 remains on `OWNER_HOLD`.
  - PR 1 remains on `DO_NOT_MERGE` (sliced outline only).
  - A2 remains on `HOLD` pending scope coordination.
