# R72 Agent07 Visual E2E Harness Recovery Checkpoint

- **Branch**: `r72/agent07-visual-r2` (forked from `9788666`)
- **Role**: Test sub-agent (bounded recovery, <= 25 tool calls)
- **Scope**: Test/harness ONLY. No product code changes.

## Objectives & Plan
1. **Fixture Deduplication**:
   - Compare `e2e/r72-logistics-fixtures.ts` vs `helpers/r72-logistics-fixtures.ts`.
   - Identify active import in `e2e/r72-logistics-ux.demo.ts`.
   - Remove unused duplicate fixture file safely in this branch while preserving all test cases.
2. **Fix Test Bugs in `e2e/r72-logistics-ux.demo.ts`**:
   - Off-screen footer vs last row: Scroll to maximum and settle animation/render frames BEFORE asserting viewport geometry (`bottom 5497 vs footer 694` was due to off-screen unscrolled state).
   - Arbitrary `title min 220px` invalid at 320px width: derive identity width dynamically from card content width minus checkbox/padding/gaps (~199px on 320px screen).
   - Assert controls remain below identity and do not overlap across all 21 items.
   - Include both normal/short names and long Thai/English SKU names (ensuring long names don't wrap and falsely mask control overlaps).
   - Honest simulation: supported CDP insets, simulated root font 200%, honest viewport shrink (no fake OS claims).
3. **Baseline Red Capture**:
   - Baseline 992 has PO prices but lacks PR55 runtime and Agent02/05 mobile fixes.
   - Genuine baseline REDs will be recorded honestly without modifying production code.
4. **Verification**:
   - Run type checks / tsc-e2e.
   - Run baseline test assertions, capture screenshots.
   - Output QA_HARNESS_READY / RED_EXPECTED status.

## MAIN reconciliation after bounded recovery

**Actual status: PARTIAL / RUNTIME_VERIFICATION_PENDING, not visual PASS.** The child completed its 25-call budget without a second provider 502, but did not commit or execute the changed harness. MAIN preserved the tracked patch and this checkpoint outside the repository before taking ownership.

- Actual T3 receipt: `opencode` / `9router/gemini-3.8-flash-high`, `variant=high`; the child's prose `options={}` was not the selection receipt.
- Private dependency directory verified by `lstat` and `realpath`; no junction installation or repeated `npm ci` by MAIN.
- Correct E2E project: `node node_modules/typescript/bin/tsc -p e2e/tsconfig.json --noEmit` **PASS**. Initial command using nonexistent `tsconfig.e2e.json` failed before compilation; retained in `agent07-main-gates/results.json`.
- Playwright test enumeration **PASS: 17 tests**. This is not execution evidence.
- First selected browser attempt failed before launch because the timed-out dependency installation left no `vite.cmd` shim. Config now invokes the installed Vite Node entry directly (Vite 8.1.4).
- Second attempt reached dependency optimization but failed on missing `es-toolkit/dist/compat/...` files. **Neither attempt is a genuine layout RED.** Logs retained in `agent07-main-gates/`.
- Next: run the preserved harness in MAIN's already-qualified private pinned checkout with an identical package-lock, then classify actual baseline failures and test the combined candidate. Do not patch application code to work around these installation failures.
- The seven existing before PNGs predate the mixed short/long-name fixture; recapture matching-fixture before/after evidence for final comparisons.
