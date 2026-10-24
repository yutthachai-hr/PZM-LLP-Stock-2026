# R72 Navigation Fixes Independent Review Report — Round 2

- **Target Commit:** `e974e68` vs `9b40a10` (Round 1) and vs `1651548` (PR55 base)
- **Reviewer:** Independent Review Sub-agent (Pstack / opencode)
- **T3 Provider:** `opencode`
- **Model:** `9router/gemini-3.8-flash-high`
- **Variant:** `high`
- **Verdict:** **APPROVE**
- **Runtime Verdict:** **PASS** (13/13 real-browser DOM integration tests verified via Playwright Chromium)

---

## 1. Executive Summary

Round 2 commit `e974e68` addresses all three objections from Round 1 (`1cb7ead`):
1. **Suppliers Same-ID Re-click & Selection Desync:** Added `location.key` to `Suppliers.tsx` effect dependencies `[queryId, location.key]`. Every React Router navigation emits a distinct location key, ensuring that re-clicking the same query ID after manual row selection or closing the drawer reliably re-opens the target supplier.
2. **Issue POS & Import Reactive Transitions:** Updated `Issue.tsx` with reactive synchronization on `[location.key, params, defaultMode]` and precedence handling in `initialMode`. Navigating to `?import=1` from POS mode switches to `defaultMode` (`transfer` for managers, `consume` for staff), mounting `LineBuilder` to consume the flag without loops. Dynamic navigation to `?mode=pos` correctly activates POS mode while preserving manual selections during URL cleanup.
3. **DOM & Browser Verification:** Executed live browser verification using Playwright Chromium across 13 distinct SPA navigation scenarios, proving clean transition behavior without infinite loops or state corruption.

---

## 2. Technical Audit of Round 2 Changes

### (a) Suppliers Location Change Re-firing Audit
- **Source:** `src/pages/Suppliers.tsx:140-145`
  ```tsx
  useEffect(() => {
    if (queryId) {
      setSelectedId(queryId)
      setSheetOpen(true)
    }
  }, [queryId, location.key])
  ```
- **Audit for Unintended Drawer Re-opening:**
  - Audited `src/pages/Suppliers.tsx` and all child components (`SupplierDetail.tsx`, `ImportFromCatalogue`, `SupplierEditor`, `AddProductModal`, `DataTable`, `FilterBar`).
  - **Findings:** **NONE**. Neither `Suppliers.tsx` nor any child component calls `setSearchParams` or `useNavigate` while keeping `?id` in the URL.
  - All internal filters (`search`, `category`, `shown`, `returns`, `terms`, `sort`) use local React `useState`.
  - Links in `SupplierDetail.tsx` (`/orders?po=...`, `/products/.../card`) navigate completely away to separate top-level pages.
  - Consequently, `location.key` changes *only* on intentional external router navigations (e.g. notifications, navbar, or browser history), preventing spurious drawer re-openings when interacting locally.

### (b) Issue Effect & Params Identity Audit
- **Source:** `src/pages/Issue.tsx:37-52`
  ```tsx
  const defaultMode: Mode = manager ? 'transfer' : 'consume'
  const initialMode: Mode =
    params.get('import') === '1'
      ? defaultMode
      : params.get('mode') === 'pos'
        ? 'pos'
        : defaultMode
  const [mode, setMode] = useState<Mode>(initialMode)

  useEffect(() => {
    if (params.get('import') === '1') {
      setMode((current) => (current === 'pos' ? defaultMode : current))
    } else if (params.get('mode') === 'pos') {
      setMode('pos')
    }
  }, [location.key, params, defaultMode])
  ```
- **LineBuilder URL Consumption Interaction:**
  - When `LineBuilder` mounts, its effect runs `next.delete('import'); setParams(next, { replace: true })`.
  - React Router re-renders `IssuePage` with the updated `params`.
  - In `IssuePage`'s effect, `params.get('import') === '1'` is now `false`, and `params.get('mode') === 'pos'` is `false`. Neither branch fires.
  - `setMode` is not called, preventing any reset of manual mode selection or infinite render loop.
  - If a user manually changes mode (e.g. to `consume`), unrelated location or search param changes do not reset `mode` because neither `import=1` nor `mode=pos` is matched.
  - If `?import=1` arrives while the user is already on `consume`, `current === 'pos'` is false, so `mode` remains `consume`.

### (c) Issue `initialMode` Precedence (`?mode=pos&import=1`)
- **Source:** `src/pages/Issue.tsx:38-44`
- When both `?mode=pos&import=1` are passed simultaneously:
  - `params.get('import') === '1'` evaluates first, setting `initialMode` to `defaultMode`.
  - This guarantees that `LineBuilder` mounts and processes the one-shot import payload rather than being blocked by `PosImportForm`.

### (d) Staff Role Default Mode (`consume`)
- **Source:** `src/pages/Issue.tsx:37`
  - `const defaultMode: Mode = manager ? 'transfer' : 'consume'`
  - For `staff` (`manager === false`), `defaultMode` is `'consume'`.
  - Crucial architectural match: `TransferForm:214-239` restricts direct transfers for non-managers and does **not** render `LineBuilder`. `ConsumeForm:475` renders `LineBuilder` with `importable`.
  - Setting `defaultMode` to `consume` ensures non-manager staff navigating via `?import=1` land on `ConsumeForm`, where `LineBuilder` can successfully mount and open the import modal.

### (e) Test Suite Quality & 13 Browser Verification Cases
- **Unit Test File (`tests/r72-navigation-shortcuts-regression.test.ts`):**
  - Contains **static code inspection assertions** via `readFileSync` (Sections 1, 2, 3 check literal tokens and regexes) and **synthetic in-memory unit simulations** (Sections 4 and 5 simulate state updates via plain JS functions).
  - Must be explicitly categorized as **static / logic unit tests**, not live rendered DOM integration tests.
- **Real Browser Proof (`docs/mission/r72/tools/nav-browser-proof.cjs`):**
  - Executed using Playwright Chromium in demo mode against real Vite build:
    - Base `1651548`: **7/13 PASS** (Failed on same-ID re-clicks, drawer reopen after close, and Issue POS/import transitions).
    - Commit `e974e68`: **13/13 PASS** (100% success).
  - The 13 browser cases cover:
    1. Suppliers deep link `?id=A` opens A (PASS)
    2. Suppliers SPA `?id=A -> ?id=B` shows B (PASS)
    3. Suppliers drawer closes manually and stays closed (PASS)
    4. Suppliers SPA same `?id=B` after close reopens B (PASS)
    5. Suppliers manual pick A then explicit SPA same `?id=B` shows B (PASS)
    6. Issue initial `?import=1` opens import (PASS)
    7. Issue one-shot import flag removed from URL (PASS)
    8. Issue manual POS selected (PASS)
    9. Issue POS -> SPA `?import=1` switches to transfer and opens import (PASS)
    10. Issue no URL/state loop after flag removal (PASS)
    11. Issue SPA `?mode=pos` switches to POS (PASS)
    12. Issue manual transfer kept while URL still `?mode=pos` (PASS)
    13. Issue explicit SPA same `?mode=pos` after manual switch returns POS (PASS)
- **Identified Coverage Gaps (Non-blocking):**
  - Staff role (`isManager === false`) landing on `/issue?import=1` was verified statically and via unit test, but was not included in the 13 Playwright browser cases (which staged `admin`).
  - Compound query `?mode=pos&import=1` was verified via code walkthrough, but omitted from browser test matrix.

---

## 3. Final Conclusion & Approval

The implementation in `e974e68` provides minimal, robust, and edge-case correct fixes adhering to Owner requirements, PR55 architecture, and draft/stock safety invariants.

**Verdict:** **APPROVE**
