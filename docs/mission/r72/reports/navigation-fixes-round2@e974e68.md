# R72 Navigation Shortcuts Fixes — Round 2

## Root Cause Analysis & Changes

### 1. Suppliers same-query re-click (?id=A -> manual select B -> re-click ?id=A)
- **Problem:** When navigating to the same query id already in the URL after manual row selection, `queryId` did not change, so `useEffect(..., [queryId])` was skipped, leaving supplier B selected.
- **Fix:** Added React Router's `location.key` to effect dependencies (`[queryId, location.key]`). Every router navigation emits a new `location.key`, re-triggering supplier selection and sheet opening without resetting on unrelated local state changes.

### 2. IssuePage POS & Import transitions
- **Problem:** `IssuePage` initialized `mode` via `useState` once. Navigating from POS mode to `/issue?import=1` retained `mode === 'pos'`, leaving `PosImportForm` rendered and `LineBuilder` unmounted. Dynamic navigations to `?mode=pos` were also ignored.
- **Fix:** Added navigation effect in `IssuePage`:
  - `?import=1` switches POS mode to `defaultMode` (`manager ? 'transfer' : 'consume'`), allowing `LineBuilder` to mount and consume the one-shot flag.
  - `?mode=pos` switches to POS mode, including re-clicks after manual card selection.
  - Manual mode card selection is preserved and protected against loops when `LineBuilder` clears the URL flag.

## Verification
- Unit & regression suite updated in `tests/r72-navigation-shortcuts-regression.test.ts`.
- Real browser verification status: BLOCKED / PARTIAL (worktree `t3-1cddff59` lacks local node_modules under private npm ci / no-junction rule; Port 5220 Vite server could not be started without unapproved network/install operations).
