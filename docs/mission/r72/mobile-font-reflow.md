# R72 Mobile Font Reflow — Acceptance Gap & Fix Report

**Status:** REVIEW_PENDING  
**Branch:** `r72/mobile-font-reflow` (branched from `c9332ec`)  
**Scope:** `src/pages/transfers/TransferReceivePage.tsx` + `src/pages/transfers/transfer-receive.css`  
**Target:** Elimination of horizontal scrolling (`scrollWidth > innerWidth`) under root `fontSize = 200%` (32px root font) across mobile phone widths (320px–430px) while maintaining ≥44px checkbox and ≥48px stepper touch targets, 4-row mobile semantics, unit label visibility, and decimal `1.063 KG` precision.

---

## 1. Checkpoint & Root Cause Analysis

### Prior Review Findings (`30295b9`)
- Branch `r72/agent02-logistics-mobile` established 4-row mobile cards and hit targets.
- However, when the browser/OS root font scale was increased to 200% (`document.documentElement.style.fontSize = '200%'` / 32px root font), rem-based dimensional utility classes scaled up:
  - Stepper buttons `!h-12 !w-12` (`3rem`) grew from 48px to 96px width each.
  - Checkbox hit target `h-11 w-11` (`2.75rem`) grew from 44px to 88px.
  - Unit badge `min-w-[2.5rem]` grew to 80px.
  - Stepper row gaps `gap-2` (`0.5rem`) grew to 16px.
  - Header icons with `h-11 w-11` grew to 88px width, inflating header bounds.
- Total intrinsic width of the non-wrapping stepper flex row exceeded all mobile viewport widths (scrollWidth = 516px), causing horizontal scrollbars (`overflow` up to 196px at 320px width) and squashing the quantity input down to 50px width.

### Acceptance Gap & Ruling
- Main ruling classified this as `CHANGES_REQUESTED` (not waived).
- Physical tap targets must stay ≥44px (checkbox) and ≥48px (stepper) without uncontrolled rem inflation causing horizontal page blowout.

---

## 2. Geometric Measurements Matrix (Before RED vs After GREEN)

Captured on port 5214 via `scripts/test-font-reflow.mjs`:
- RED Commit: `b5d0d5e`
- GREEN Commit: `HEAD`

### Normal Root Font (100% / Computed 17px)

| Viewport Width | Scroll Width | Inner Width | Overflow | Has H-Scroll | Stepper Size (±) | Checkbox Target | Input Size | Status |
|---|---|---|---|---|---|---|---|---|
| **320px** | 320px | 320px | 0px | **false** | 48px × 48px | 44px × 44px | 111px × 48px | **PASS** |
| **360px** | 360px | 360px | 0px | **false** | 48px × 48px | 44px × 44px | 151px × 48px | **PASS** |
| **375px** | 375px | 375px | 0px | **false** | 48px × 48px | 44px × 44px | 166px × 48px | **PASS** |
| **390px** | 390px | 390px | 0px | **false** | 48px × 48px | 44px × 44px | 181px × 48px | **PASS** |
| **414px** | 414px | 414px | 0px | **false** | 48px × 48px | 44px × 44px | 205px × 48px | **PASS** |
| **430px** | 430px | 430px | 0px | **false** | 48px × 48px | 44px × 44px | 221px × 48px | **PASS** |

### Accessibility Large Font (Root 200% / Computed 32px)

| Viewport Width | Before Scroll Width | After Scroll Width | Before Overflow | After Overflow | Has H-Scroll | Stepper Size (±) | Checkbox Target | Input Size | Status |
|---|---|---|---|---|---|---|---|---|---|
| **320px** | 516px | **320px** | 196px | **0px** | **false** | 48px × 48px | 44px × 44px | 78px × 88px | **PASS** |
| **360px** | 516px | **360px** | 156px | **0px** | **false** | 48px × 48px | 44px × 44px | 54px × 88px | **PASS** |
| **375px** | 516px | **375px** | 141px | **0px** | **false** | 48px × 48px | 44px × 44px | 69px × 88px | **PASS** |
| **390px** | 516px | **390px** | 126px | **0px** | **false** | 48px × 48px | 44px × 44px | 84px × 88px | **PASS** |
| **414px** | 516px | **414px** | 102px | **0px** | **false** | 48px × 48px | 44px × 44px | 108px × 88px | **PASS** |
| **430px** | 516px | **430px** | 86px | **0px** | **false** | 48px × 48px | 44px × 44px | 124px × 88px | **PASS** |

### Functional Usability Checks
- **21 Items (Short & Long Names):** All 21 rows render correctly without clipping, layout shifts, or row squashing.
- **Sequential Decimal Typing `1.063`:** Exact value `1.063` typed sequentially and preserved.
- **Touch Target Integrity:** Checkbox target maintained at exactly 44×44px (WCAG 2.5.5 minimum 44px); Stepper buttons maintained at 48×48px.
- **Physical Keyboard:** Physical keyboard not claimed (simulated in headless browser test).

---

## 3. Visual Artifacts Inventory

Baseline & verification artifacts in `docs/mission/r72/artifacts/reflow/`:
- `receive-320-root200-before.png`: Baseline showing 516px horizontal page blowout at 320px width under root 200%.
- `receive-390-root200-before.png`: Baseline showing 516px horizontal page blowout at 390px width under root 200%.
- `receive-320-root200.png`: Post-fix verification showing zero horizontal scroll at 320px width under root 200%.
- `receive-390-root200.png`: Post-fix verification showing zero horizontal scroll at 390px width under root 200%.

---

## 4. Verification Suite Results

```bash
# Unit Tests (7 tests in transfer-receive-card)
npx vitest run tests/transfer-receive-card.test.ts
# Result: 1 passed (1), 7 passed (7), 203ms

# TypeScript Check
npx tsc --noEmit
# Result: 0 errors

# Linter Check
npm run lint
# Result: 0 errors in touched files

# i18n Translation Completeness
npm run i18n:check
# Result: 0 missing keys, every Thai UI string is translated

# Browser Geometry Suite
node scripts/test-font-reflow.mjs
# Result: Zero overflow / hasHScroll=false across all 6 viewports at normal and root 200%
```

---

## 5. Scope Boundary Compliance

- No edits to `src/components/ui.tsx`, `src/components/BottomTabBar.tsx`, or `src/index.css` (Agent05 lease respected).
- No edits to backend, business logic, accounting, or security rules.
- Local stylesheet `src/pages/transfers/transfer-receive.css` handles scoped button sizing and mobile header bounds under accessibility zoom.
