# R72 Mobile Font Readable — Round 2 Audit & Fix Report

**Status:** REVIEW_PENDING  
**Branch:** `r72/mobile-font-readable` (branched from `6e7cdfcd0a1a08ec8086b97bc690502a2fed236a`)  
**Merge Base SHA with 8d2582b:** `6045b502171b1639d1e55c0f09e9a910e14ad064`  
**Fix Base SHA (after merging approved shared 8d2582b):** `8eabe397a0ef7f887c35de5e4e88869956389647`  
**Baseline RED Checkpoint Commit:** `f40010468e8b0b925b3310cbfe5b948f2fafe3ea`  
**Port Used for Verification:** 5221 (Vite demo mode, strictly isolated, no emulators)  
**Scope Touched:**  
- `src/pages/transfers/TransferReceivePage.tsx`
- `src/pages/transfers/transfer-receive.css` (deleted entirely)
- `src/components/TopBar.tsx` (scoped mobile icon tap boxes & header title flex)
- `scripts/test-font-reflow.mjs` (measurement test script)
- `docs/mission/r72/artifacts/reflow/` (metrics JSON & PNG screenshots)

---

## 1. Problem Statement & Root Cause (Review 4500450 CHANGES_REQUESTED)

1. **Input Usable Width Squashed Under Root 200% (32px root font):**
   - At 360px viewport under root font 200%, the quantity input in commit `6e7cdfc` was flex-compressed to 54px bounding width.
   - The default `inputBase` styling applied `px-3` (`0.75rem * 32px = 24px` left + `24px` right = 48px padding) plus 2px border.
   - Usable content width: $54\text{px} - 48\text{px} - 2\text{px} = \mathbf{4\text{px}}$.
   - Rendered text `1.063` with computed font `36px` has an actual canvas text width of $71.8\text{px}$ to $75.4\text{px}$.
   - Result: `1.063` was severely clipped across 320px, 360px, 375px, 390px, and 414px viewports.
2. **Cross-Route Header CSS Pollution:**
   - Commit `6e7cdfc` introduced global unscoped CSS in `transfer-receive.css`:
     ```css
     @media (max-width: 640px) {
       header button {
         max-width: 44px !important;
         max-height: 44px !important;
       }
       header span.h-9.w-9 {
         height: 36px !important;
         width: 36px !important;
       }
     }
     ```
   - Once `/transfers/:id/receive` was visited, this stylesheet remained active globally across client navigation, forcibly clipping every `<header button>` in the application to $44\text{px} \times 44\text{px}$ (including buttons with text labels).

---

## 2. Minimal Solution Implemented

1. **Eliminated `transfer-receive.css` Entirely:**
   - Deleted `src/pages/transfers/transfer-receive.css` and removed its import in `TransferReceivePage.tsx`.
   - Completely removes any leaked CSS selectors after unmount or route change.
2. **TransferReceivePage Stepper Reflow Architecture:**
   - Control gaps: Switched from rem `gap-2` ($16\text{px}$ at root 200%) to fixed `gap-[8px]`.
   - Input horizontal padding: Replaced rem `px-3` ($48\text{px}$ at root 200%) with fixed `!px-[8px]` ($8\text{px}$ left, $8\text{px}$ right = $16\text{px}$ total).
   - Input minimum width: Configured `!min-w-[96px]`.
   - Usable content width: $96\text{px} - 16\text{px (padding)} - 2\text{px (border)} = \mathbf{78\text{px}}$, comfortably exceeding the $71.8\text{px}$ canvas measurement of `1.063` across all 6 viewports.
   - Stepper touch targets: Maintained at `!h-[48px] !w-[48px] !min-h-[48px] !min-w-[48px]`.
   - Checkbox target: Maintained at `h-[44px] w-[44px] min-h-[44px] min-w-[44px]`.
   - Grouping: Wrapped minus, input, and plus inside an inner flex group `flex items-center gap-[8px] flex-1 sm:flex-none`, allowing the unit label (`KG`, `Pack`, etc.) to wrap cleanly without shrinking the input below $96\text{px}$.
3. **App Header (`TopBar.tsx`) Refactor:**
   - Scoped icon tap boxes: Replaced rem `h-11 w-11` on header icon buttons with fixed `h-[44px] w-[44px] min-h-[44px] min-w-[44px] shrink-0` and UserMenu avatar `h-[36px] w-[36px] min-h-[36px] min-w-[36px] shrink-0`.
   - Tightened flex spacing on mobile (`gap-1 sm:gap-2` and `gap-0.5 sm:gap-1`) and gave title `min-w-0 flex-1 truncate` so that title cleanly truncates on 320px screens rather than forcing right-side controls off-screen.
   - Zero unscoped or global header rules.

---

## 3. Real Browser Verification Metrics (Port 5221)

All measurements captured in Chromium via `scripts/test-font-reflow.mjs` against demo server on port 5221.

### Accessibility Zoom: Root Font 200% (32px root font)

| Viewport Width | Baseline (6e7cdfc) Usable Content W | GREEN Input Bounding Box | GREEN Horizontal Padding | GREEN Usable Content W | Canvas Width ('1.063') | Clipped? | Overflow (scrollWidth - innerWidth) | Touch Targets (CB / Minus / Plus) |
|---|---|---|---|---|---|---|---|---|
| **320px** | 28.0px | 96px × 88px | 16px | **78.0px** | 71.8px | **NO** | **0px** | 44px / 48px / 48px |
| **360px** | **4.0px (BUG)** | 134px × 88px | 16px | **116.0px** | 71.8px | **NO** | **0px** | 44px / 48px / 48px |
| **375px** | 19.0px | 149px × 88px | 16px | **131.0px** | 71.8px | **NO** | **0px** | 44px / 48px / 48px |
| **390px** | 34.0px | 108px × 88px | 16px | **89.6px** | 71.8px | **NO** | **0px** | 44px / 48px / 48px |
| **414px** | 58.0px | 132px × 88px | 16px | **113.6px** | 71.8px | **NO** | **0px** | 44px / 48px / 48px |
| **430px** | 74.0px | 148px × 88px | 16px | **129.6px** | 71.8px | **NO** | **0px** | 44px / 48px / 48px |

### Normal Font: Root Font 100% (16px root font)

| Viewport Width | GREEN Input Bounding Box | GREEN Usable Content W | Canvas Width ('1.063') | Clipped? | Overflow | Touch Targets (CB / Minus / Plus) | Status |
|---|---|---|---|---|---|---|---|
| **320px** | 113px × 48px | 94.8px | 38.2px | **NO** | **0px** | 44px / 48px / 48px | **PASS** |
| **360px** | 153px × 48px | 134.8px | 38.2px | **NO** | **0px** | 44px / 48px / 48px | **PASS** |
| **375px** | 168px × 48px | 149.8px | 38.2px | **NO** | **0px** | 44px / 48px / 48px | **PASS** |
| **390px** | 183px × 48px | 164.8px | 38.2px | **NO** | **0px** | 44px / 48px / 48px | **PASS** |
| **414px** | 207px × 48px | 188.8px | 38.2px | **NO** | **0px** | 44px / 48px / 48px | **PASS** |
| **430px** | 223px × 48px | 204.8px | 38.2px | **NO** | **0px** | 44px / 48px / 48px | **PASS** |

### Cross-Route Header Pollution Test

- Navigated to `/transfers/TR-INT-998822/receive` then directly to `/`.
- Inspected all `header button` computed styles:
  - `maxWidth: "none"`
  - `maxHeight: "none"`
  - `isPolluted: false`
- Confirmation: Zero residual styles leak across route unmounts.

### Behavioral & Precision Checks

- **Sequential Typing `1.063`:** Successfully typed into Item 2 (Mozzarella Cheese) under root 200% at 360px viewport; resulting input value is exactly `"1.063"`.
- **21 Items Display:** All 21 items render short and long Thai names, SKU codes, units, and dispatch numbers cleanly without overlap or clipping.
- **Default 4-Row Semantic Layout:** Maintained under standard mobile viewports; reflow gracefully accommodates zoom when root font scales to 200%.

---

## 4. Verification Suite Results

```bash
# 1. Unit Tests (7 tests in transfer-receive-card)
node ./node_modules/vitest/vitest.mjs run tests/transfer-receive-card.test.ts
# Result: 1 passed (1), 7 passed (7), 195ms

# 2. TypeScript Typecheck
node ./node_modules/typescript/bin/tsc -b
# Result: 0 errors

# 3. Linter (Oxlint)
npm run lint
# Result: 0 errors / 0 warnings in touched files

# 4. i18n Translation Completeness
npm run i18n:check
# Result: 0 missing keys, every Thai UI string translated

# 5. E2E Geometry Suite
node -e "import('./scripts/test-runner.mjs')"
# Result: 0px overflow across all 6 viewports at normal and root 200%
```

---

## 5. Artifacts Checklist

- `docs/mission/r72/artifacts/reflow/red-metrics.json`
- `docs/mission/r72/artifacts/reflow/green-metrics.json`
- `docs/mission/r72/artifacts/reflow/green-receive-320-root200.png`
- `docs/mission/r72/artifacts/reflow/green-receive-360-root200.png`
- `docs/mission/r72/artifacts/reflow/green-input-qty-320-root200.png`
- `docs/mission/r72/artifacts/reflow/green-input-qty-360-root200.png`
