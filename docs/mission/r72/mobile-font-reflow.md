# R72 Mobile Font Reflow — Acceptance Gap & Fix Report

**Status:** REVIEW_PENDING  
**Branch:** `r72/mobile-font-reflow` (branched from `c9332ec`)  
**Scope:** `src/pages/transfers/TransferReceivePage.tsx`  
**Target:** Elimination of horizontal scrolling (`scrollWidth > innerWidth`) under root `fontSize = 200%` (32px root font) across mobile phone widths (320px–430px) while maintaining ≥44px checkbox and ≥48px stepper touch targets, 4-row mobile semantics, unit label visibility, and decimal `1.063 KG` precision.

---

## 1. Checkpoint & Root Cause Analysis

### Prior Review Findings (`30295b9`)
- Branch `r72/agent02-logistics-mobile` established 4-row mobile cards and hit targets.
- However, when the browser/OS root font scale is increased to 200% (`document.documentElement.style.fontSize = '200%'` / 32px root font), rem-based dimensional utility classes scaled up:
  - Stepper buttons `!h-12 !w-12` (`3rem`) grew from 48px to 96px width each.
  - Checkbox hit target `h-11 w-11` (`2.75rem`) grew from 44px to 88px.
  - Unit badge `min-w-[2.5rem]` grew to 80px.
  - Stepper row gaps `gap-2` (`0.5rem`) grew to 16px.
- Total intrinsic width of the non-wrapping stepper flex row exceeded all mobile viewport widths (scrollWidth = 516px), causing horizontal scrollbars (`overflow` up to 196px at 320px width) and squashing the quantity input down to 50px width.

### Acceptance Gap
- Main ruling classified this as `CHANGES_REQUESTED` (not waived).
- Physical tap targets must stay ≥44px (checkbox) and ≥48px (stepper) without uncontrolled rem inflation causing horizontal page blowout.

---

## 2. RED Baseline Measurements (Root Font 200% / Computed 32px)

Captured on port 5214 via `scripts/test-font-reflow.mjs` against commit `c9332ec`:

| Viewport Width | Computed Root Font | Inner Width | Scroll Width | Overflow | Has H-Scroll | Stepper Button Size (±) | Checkbox Target Size | Input Width |
|---|---|---|---|---|---|---|---|---|
| **320px** | 32px | 320px | 516px | 196px | **FAIL (true)** | 96px × 96px | 88px × 88px | 50px |
| **360px** | 32px | 360px | 516px | 156px | **FAIL (true)** | 96px × 96px | 88px × 88px | 50px |
| **375px** | 32px | 375px | 516px | 141px | **FAIL (true)** | 96px × 96px | 88px × 88px | 50px |
| **390px** | 32px | 390px | 516px | 126px | **FAIL (true)** | 96px × 96px | 88px × 88px | 50px |
| **414px** | 32px | 414px | 516px | 102px | **FAIL (true)** | 96px × 96px | 88px × 88px | 50px |
| **430px** | 32px | 430px | 516px | 86px | **FAIL (true)** | 96px × 96px | 88px × 88px | 50px |

Sequential decimal typing `1.063`: PASS (`1.063`).
Baseline artifacts:
- `docs/mission/r72/artifacts/reflow/receive-320-root200-before.png`
- `docs/mission/r72/artifacts/reflow/receive-390-root200-before.png`
