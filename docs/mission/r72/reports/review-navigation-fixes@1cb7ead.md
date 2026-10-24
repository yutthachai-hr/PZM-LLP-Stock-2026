# R72 Navigation Fixes Independent Review Report

- **Branch / Worktree:** Detached at `9b40a10` vs `b36e9a8`
- **Reviewer:** Independent Review Sub-agent (Pstack / opencode Gemini 9router high)
- **Role:** Quality, Regression, and Route Contract Review
- **Verdict:** **CHANGES_REQUESTED**
- **Runtime Verdict:** **UNVERIFIED** (No headless/browser DOM test suite exists for dynamic shortcuts; static file regex is not actual React UI proof)

---

## 1. Executive Summary

Implementer commit `9b40a10` attempted 3 navigation bugfixes:
1. `NotificationBell.tsx`: Route path change to `/settings/notifications`.
2. `Suppliers.tsx`: Reactive query state via `useSearchParams()`.
3. `LineBuilder.tsx`: Effect dependency and modal open trigger for `?import=1`.

While Fix 1 (`NotificationBell`) is correct and cleanly matches the route contract in `src/App.tsx`, **Fix 2 (`Suppliers.tsx`) and Fix 3 (`LineBuilder.tsx` / `Issue.tsx`) contain concrete edge-case defects and gaps in connected code execution flow.**

---

## 2. Detailed Technical Audit of Unresolved Objections

### Objection 1: Suppliers Master-Detail Deep Link & Selection State
- **File:** `src/pages/Suppliers.tsx:128-144`
- **Audit Findings:**
  - **`?id=A -> ?id=B` Navigation:** PASS. When search params transition from `?id=A` to `?id=B`, `queryId` changes, triggering `useEffect` which updates `selectedId` to `B` and sets `sheetOpen = true`.
  - **Manual Pick B followed by Navigation to SAME `?id=A`:** **FAIL (BUG)**.
    1. User navigates to `/suppliers?id=A`. Sheet opens with Supplier A.
    2. User clicks Supplier B in the table. `select('B')` runs, setting `selectedId = 'B'`.
    3. Notice: `select('B')` does not update or clear URL search params. The URL remains `/suppliers?id=A`.
    4. User now clicks a notification or link navigating to `/suppliers?id=A`.
    5. React Router processes navigation to `/suppliers?id=A`. `queryId` evaluated from search params was `'A'` and is still `'A'`.
    6. Because `queryId` did not change, `useEffect([queryId])` **does not fire**.
    7. `selectedId` remains `'B'`. The UI continues displaying Supplier B despite explicit navigation to A.
  - **Sheet Close Behavior:**
    When user closes drawer via `closeSheet()`, `sheetOpen` becomes `false`, but `?id=A` remains in the URL. Subsequent click on `/suppliers?id=A` fails to reopen the sheet because `queryId` did not change.
  - **Architectural Deviation:**
    Unlike `Orders.tsx:275` (`setParams({}, { replace: true })`), `CalendarPage.tsx:122` (`setParams({}, { replace: true })`), and `LineBuilder.tsx:101` (`next.delete('import'); setParams(next)`), `Suppliers.tsx` never consumes or clears the one-shot deep link query parameter, creating URL-state desynchronization.

---

### Objection 2: IssuePage `?import=1` and `?mode=pos` Connected Flow
- **File:** `src/pages/Issue.tsx:35-37, 46-52`, `src/components/LineBuilder.tsx:96-104`
- **Audit Findings:**
  - **Same-page Reopen in Transfer / Consume Mode:** PASS. When `LineBuilder` is mounted, `useEffect([importable, params, setParams])` detects `params.get('import') === '1'`, sets `setImporting(true)`, and consumes the parameter with `next.delete('import')`.
  - **Navigation from Current POS Mode (`?import=1`):** **FAIL (BUG)**.
    1. In `src/pages/Issue.tsx:36`:
       ```tsx
       const [params] = useSearchParams()
       const [mode, setMode] = useState<Mode>(params.get('mode') === 'pos' ? 'pos' : manager ? 'transfer' : 'consume')
       ```
    2. `mode` is stored in React `useState`, initialized once on mount.
    3. If user is in POS mode (`mode === 'pos'`, entered via `/issue?mode=pos` or user clicking "ตัดตามยอดขาย POS" in `ModeCards`), `IssuePage` mounts `<PosImportForm ... />`.
    4. Neither `TransferForm` nor `ConsumeForm` is mounted. `PosImportForm` does **not** render `LineBuilder`.
    5. If user clicks a quick action / shortcut linking to `/issue?import=1`:
       - `params` updates with `import=1`.
       - Because `IssuePage` lacks a reactive `useEffect` on `params`, `mode` remains `'pos'`.
       - `<PosImportForm>` remains mounted. `LineBuilder` is **never mounted**.
       - `LineBuilder`'s import effect never runs, the import modal never opens, and `?import=1` is never consumed from the URL.
  - **Dynamic `?mode=pos` Navigation while already on `/issue`:** **FAIL (BUG)**.
    If user is on `/issue` (in default `'transfer'` mode) and navigates via link to `/issue?mode=pos` (e.g. from recipes or dashboard), `mode` remains `'transfer'` because `useState` does not update on query parameter changes.

---

### Objection 3: Existing LineBuilder Callers & Integrity
- **Files:** `src/components/LineBuilder.tsx`, `src/pages/Receive.tsx`, `src/pages/transfers/TransferEditor.tsx`, `src/pages/transfers/TransferDetailView.tsx`
- **Audit Findings:**
  - `LineBuilder.tsx` self-contains one-shot consumption without adding mandatory props.
  - Existing callers (`Receive.tsx`, `TransferEditor.tsx`, `TransferDetailView.tsx`) preserve line drafting, barcode scanning, quantity changes, and cancelation behavior without regressions.
  - No new props needed on `LineBuilderProps`.

---

## 3. Test Suite & Verification Audit

- **Static Contract & Regression Tests:**
  - `tests/r72-navigation-shortcuts-regression.test.ts`: **7 passed**
  - `tests/notification-link.test.ts`: **2 passed**
  - `tests/r72-navigation-contract.test.ts`: **82 passed**
  - Total focused suite: **126 passed**
- **Test Quality Assessment:**
  - `tests/r72-navigation-shortcuts-regression.test.ts` uses `readFileSync` to perform static regex checks and simulates dummy functions (`reactiveEffect`, `runEffect`) in memory.
  - It does **not** mount React components (`SuppliersPage`, `IssuePage`, `LineBuilder`) or test React Router state integration.
  - It omitted the edge cases identified above:
    - Same-ID re-navigation after manual table pick in `Suppliers`.
    - POS mode active when navigating to `/issue?import=1`.
    - Dynamic transitions between `/issue` and `/issue?mode=pos`.
- **Static Analysis & Types:**
  - `tsc -p tsconfig.json --noEmit`: Clean (0 errors).
  - `oxlint`: Clean (0 errors in touched files).
  - `i18n:check`: Clean (All Thai strings present).
- **Runtime Verdict:** **UNVERIFIED** (Per R72 protocol: static regex pass is not live React UI / DOM proof).

---

## 4. Concrete MUST Items for Implementer

To achieve `APPROVE`, the following MUST be implemented:

1. **`src/pages/Suppliers.tsx` (Line 128-144):**
   - Consume deep link parameter via `setParams` once handled (aligning with `Orders.tsx:275`, `CalendarPage.tsx:122`, and `LineBuilder.tsx:101`):
     ```tsx
     useEffect(() => {
       if (queryId) {
         setSelectedId(queryId)
         setSheetOpen(true)
         const next = new URLSearchParams(searchParams)
         next.delete('id')
         setSearchParams(next, { replace: true })
       }
     }, [queryId, searchParams, setSearchParams])
     ```
   - This ensures URL returns cleanly to `/suppliers`. When user clicks B manually, `selectedId` is B. If user subsequent clicks link `/suppliers?id=A`, `queryId` transitions from `null -> 'A'`, correctly reopening Supplier A.

2. **`src/pages/Issue.tsx` (Lines 35-37):**
   - Add reactive synchronization for search params:
     ```tsx
     useEffect(() => {
       const m = params.get('mode')
       if (m === 'pos') {
         setMode('pos')
       } else if (params.get('import') === '1') {
         // Import transfer shortcut must show transfer line builder
         setMode('transfer')
       }
     }, [params])
     ```
   - This ensures that navigating to `/issue?mode=pos` dynamically activates POS mode, and navigating to `/issue?import=1` while in POS mode switches mode to `'transfer'`, allowing `LineBuilder` to mount, trigger the modal, and consume the parameter.

3. **`tests/r72-navigation-shortcuts-regression.test.ts`:**
   - Add explicit regression test cases covering:
     - `Suppliers`: `?id=A` -> manual pick B -> explicit navigate `?id=A` opens A.
     - `Issue`: user in POS mode -> navigate `/issue?import=1` switches mode to mount `LineBuilder`.
