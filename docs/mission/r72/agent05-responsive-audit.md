# R72 Agent 05 Responsive Shared Layout Audit & Checkpoint

## 1. Executive Summary & Context
- **Task:** Recovery and completion of Agent 05 (Responsive Shared Layout Defects).
- **Target Branch:** `r72/agent05-responsive-r2` branched cleanly from `c2fa464` (baseline with preserved harness + 40 initial phone screenshots).
- **Execution Strategy:** Minimal, backward-compatible CSS/layout fixes restricted strictly to owned files; verify with measured automated proofs and matrix capture on port 5215.

## 2. Ownership & Boundaries
- **Owned Files:**
  - `src/components/ui.tsx` (`FormActions`)
  - `src/components/nav/BottomTabBar.tsx`
  - `src/index.css` (`--tabbar-h`)
- **Strict Out-of-Scope (No Edits Allowed):**
  - `TransferReceivePage.tsx`
  - PO price logic / resolver files
  - Ledger / accounting structures
  - No changes to `package-lock.json` or npm dependencies

## 3. Four Measured RED Defects (Baseline)
From `e2e/responsive-shared.demo.ts`:
1. **Floating Plus Button Protrusion (Line 355):**
   - *Defect:* Plus button uses `absolute -top-6` (-24px / -1.5rem), protruding 24-25px above `nav.fixed.bottom-0`.
   - *Measurement:* `navBox.y - plusBox.y = 24px` (fails assertion `expect(protrusion).toBe(0)`).
2. **Floating Plus Overlaps FormActions & Missing Z-Index (Line 379):**
   - *Defect:* Sticky `FormActions` pinned to `bottom: var(--tabbar-h)` is overlapped by 24-25px by the protruding plus button. `FormActions` also lacks explicit `z-20` z-index.
   - *Measurement:* `faBottom - plusBox.y = 24-25px` (fails assertion `expect(verticalOverlap).toBe(0)` and `expect(faZ).toBe('20')`).
3. **Safe-Area Inset Squeezes Navigation Content (Line 413):**
   - *Defect:* When safe area inset bottom is 34px, fixed `height: 4.5rem` with `padding-bottom: env(safe-area-inset-bottom)` reduces available content height to ~42.5px (< 44px Apple HIG / WCAG touch target).
   - *Measurement:* `availableContentH < 44px` (fails assertion `expect(availableContentH).toBeGreaterThanOrEqual(44)`).
4. **FormActions No-Wrap on Narrow Viewports (Line 443):**
   - *Defect:* `FormActions` lacks `flex-wrap`, causing buttons to remain `nowrap` on 320px viewports.
   - *Measurement:* `getComputedStyle(el).flexWrap = 'nowrap'` (fails assertion `expect(flexWrap).toBe('wrap')`).

## 4. Minimal Targeted Fix Plan
1. **`src/index.css`:**
   - Update `--tabbar-h: calc(4.5rem + env(safe-area-inset-bottom, 0px));`
   - Keeps base content area >= 44px (4.5rem = 72-76.5px) while expanding height by bottom safe area.
   - Propagates automatically to `FormActions` sticky bottom offset.
2. **`src/components/nav/BottomTabBar.tsx`:**
   - Eliminate protrusion: change `-top-6` to `-top-px` (and `h-14 w-14`) so `protrusion == 0` and vertical overlap with `FormActions` is 0.
3. **`src/components/ui.tsx`:**
   - Add `flex-wrap` and `z-20` to `FormActions`.

## 5. Test Results & Verification Evidence
Suite command: `AUDIT_MODE=after npx playwright test --config playwright.responsive-shared.config.ts`
All 5 test suites PASSED (1.4m):
1. **Audit Matrix Capture:**
   - Captured 77 screenshots and geometry metrics (11 screens x 7 viewports: 320, 375, 390, 414, 768, 1024, 1440).
   - Saved to `docs/mission/r72/screenshots/after-metrics.json` and `docs/mission/r72/screenshots/after/*.png`.
   - **Horizontal Overflow:** 0 horizontal scroll detected across all 77 captures (`hasHorizScroll = false`).
   - **Plus Protrusion:** 0px protrusion across all 77 captures.
   - **FormActions Behavior:**
     - On sticky engaged viewports (e.g. `TransferReceive` at 390x844), vertical overlap with plus is 0px, z-index is 20.
     - On long un-scrolled forms (`POReceive`, `ManualReceive`, `Barcode` before scroll), `FormActions` sits below the fold in natural document flow until scrolled into sticky docking.
2. **PROOF 1 (Floating Plus Protrusion):**
   - Measured: `BottomTabBar y: 767.5, plus y: 767.5, protrusion: 0px`
   - Result: PASS (protrusion = 0px).
3. **PROOF 2 (FormActions Overlap & Z-Index):**
   - Measured: `FormActions bottom: 767.5, Plus top: 767.5, Vertical Overlap: 0px, FormActions z-index: 20`
   - Result: PASS (vertical overlap = 0px, z-index = 20).
4. **PROOF 3 (Safe-Area Inset Handling):**
   - Measured: `totalH=110.5px, padBottom=34px, availableContentH=76.5px, linkH=75.5px`
   - Result: PASS (available content height 76.5px >= 44px touch target).
5. **PROOF 4 (FormActions Flex-Wrap):**
   - Measured: `FormActions flex-wrap: wrap` (on 320px viewport).
   - Result: PASS.

## 6. Typecheck & Lint
- TypeScript: `npx tsc --noEmit` exited clean with 0 errors.
- Vitest: 141 test files, 1714 tests passed in 13.16s.
- Oxlint: passed (0 errors, pre-existing warnings).

