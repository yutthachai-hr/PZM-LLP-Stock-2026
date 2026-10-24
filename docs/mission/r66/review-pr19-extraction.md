# Review: PR19 i18n-Audit Extraction

- **Target Commit SHA**: `d0d4ab2a7180dbc375aa22c76f64479b948720e8` (`feat(i18n): extract AST parsing and dictionary audit from PR19`)
- **Parent Commit SHA**: `312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55` (`origin/main`)
- **Source Reference**: PR19 `aee096864282d44e1e72b6d13f627b1cff6a2e28`

## Independence Statement

This review was conducted independently by a separate agent session (`9router/gemini-3.8-flash-high`) operating in an isolated worktree (`t3-e187f8f8`). The reviewer did not author commit `d0d4ab2`.

## Files Read & Inspected

1. `scripts/i18n-audit.mjs` (commit `d0d4ab2`)
2. `scripts/i18n-check.mjs` (commit `d0d4ab2`)
3. `tests/i18n-audit.test.ts` (commit `d0d4ab2`)
4. `package.json` (commit `d0d4ab2`)
5. `HANDOFF.md` (commit `d0d4ab2`)
6. PR19 source files (`aee0968:scripts/i18n-audit.mjs`, `aee0968:scripts/i18n-check.mjs`, `aee0968:tests/i18n-audit.test.ts`)
7. Base reference file (`312f8a7:scripts/i18n-check.mjs`)

---

## 1. Gate-Strength Comparison

Empirical tests executed with isolated temporary fixtures outside the repository comparing `312f8a7` (before) against `d0d4ab2` (after):

| Case | Before Exit (`312f8a7`) | After Exit (`d0d4ab2`) | Gate Effect / Analysis |
|---|:---:|:---:|---|
| **1. Thai string with no English entry** (`t('สวัสดีชาวโลก')`, empty `EN`) | `1` | `1` | **Maintained**: Both detect key missing from `EN` and fail the CI check. |
| **2. English value that is empty** (`t('สวัสดี')`, `EN = { 'สวัสดี': '' }`) | `0` | `1` | **Strengthened**: Previously passed silently (`k in EN` was true). Now caught by `dictionaryProblems` and fails CI. |
| **3. Placeholder mismatch** (`t('มี {n} รายการ')`, `EN = { 'มี {n} รายการ': 'There are {count} items' }`) | `0` | `1` | **Strengthened**: Previously ignored placeholder names. Now caught by `dictionaryProblems` and fails CI. |
| **4. Thai characters inside English copy** (`t('สวัสดี')`, `EN = { 'สวัสดี': 'Hello สวัสดี' }`) | `0` | `1` | **Strengthened**: Previously had no leakage detection. Now caught by `dictionaryProblems` (while preserving `฿` and `THAI_DATA_VALUES`) and fails CI. |
| **5. Dynamic Thai template key** (`t(\`ข้อความ \${x}\`)`) | `1` | `1` | **Strengthened / Clarified**: Previously flagged as untranslated line; now explicitly diagnosed via AST as `Dynamic Thai translation key: use a literal key and named variables` and fails CI. |
| **6. Raw unhandled Thai copy** (Raw `'สวัสดีชาวโลก'` outside `t()`) | `1` | `1` | **Maintained**: Regex blanking correctly flags unhandled Thai copy with line numbers. |

**Conclusion on Gate Strength**: The CI gate did **not** get weaker in any scenario. It strictly maintained all prior failure modes while closing critical blind spots (empty values, mismatched placeholders, and Thai leakage).

---

## 2. False Positives & Real Repository Verification

Both commits were tested on the actual repository:

- **`312f8a7` (`main`)**:
  - Command: `npm run -s i18n:check`
  - Result: Exit `0` (Pass)
  - Key count: `2946` unique keys used
  - Warnings: 3 known unused entries in `en.ts` (`"วันที่ / เวลา"`, `"ลิงก์ยืนยันของผู้ขายใช้ได้นานสุด (วัน)"`, `"ลิงก์ยังหมดอายุหลังวันส่งด้วย"`)
- **`d0d4ab2` (`extract/20261024-pr19-i18n-audit`)**:
  - Command: `npm run -s i18n:check`
  - Result: Exit `0` (Pass)
  - Key count: `2946` unique keys used; `2946` English entries checked
  - Warnings: Identical 3 unused entries in `en.ts`
  - Output confirmation: `✓ UI copy checks passed (2946 keys; 2946 English entries).`

Zero new false positives introduced on the real codebase.

---

## 3. Scope, Dependencies & PR19 Parity

- **PR19 Parity**:
  - `scripts/i18n-audit.mjs` is byte-for-byte identical to PR19 (`aee0968`).
  - `tests/i18n-audit.test.ts` is byte-for-byte identical to PR19 (`aee0968`).
  - `scripts/i18n-check.mjs` cleanly merges PR19's audit integration while preserving `main`'s `DATA_ONLY` exemption for `productMatch.ts`.
- **Dependencies**:
  - `package.json` is untouched.
  - `typescript` was already present in `devDependencies` (`"typescript": "~6.0.2"`). Zero dependencies added.
- **Runtime / App Code**:
  - `git diff 312f8a7 d0d4ab2 -- src/` produces no output.
  - Zero runtime or app code changes.

---

## 4. Test Suite Execution (`tests/i18n-audit.test.ts`)

- Command: `npx vitest run tests/i18n-audit.test.ts`
- Results:
  - Test Files: `1 passed (1)`
  - Tests: `3 passed (3)`
  - Duration: `466ms`
- Coverage of failure cases:
  - `dictionaryProblems`: Exercises empty string translations, placeholder omission (`{n}` dropped), placeholder name divergence (`{name}` vs `{other}`), Thai leakage in English copy, and baht symbol (`฿`) allowance.
  - `translationCalls`: Exercises dynamic Thai template literals (`t(\`มี \${n} รายการ\`)`) failing closed with diagnostic problem message, while ensuring variable data passes (`t(product.name)`) without error.

---

## Findings

### Must (Blocking)
*None.*

### Should (Non-Blocking / Observations)
1. **`i18n-key` regex scope**: `scripts/i18n-check.mjs` lines 67–69 continue to scan constant table comments with single-quote regex `/'([^'\n]*[\u0e00-\u0e7f][^'\n]*)'/g`. This is existing behavior from `main` and works for all current tables, but double-quoted keys in `i18n-key` tables would not be picked up if used in future code.
2. **Hybrid AST & regex blanking**: `scripts/i18n-check.mjs` uses TypeScript AST for key extraction and problem detection, while retaining regex-based line blanking to preserve exact 1-based source line numbers for reporting unhandled Thai copy. This is a clean, minimal-diff design that avoids AST source-mapping overhead.

---

## Verdict

**APPROVE**

The extraction from PR19 is faithful, clean, and safe. The CI gate is strictly strengthened with zero regressions, zero new dependencies, and zero false positives.
