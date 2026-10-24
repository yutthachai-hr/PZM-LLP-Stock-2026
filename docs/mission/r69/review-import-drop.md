# R69 Separate-Agent Review: PR24 Drag-and-Drop Extraction on PR39

- **Date:** 2026-10-24
- **Reviewer:** R69 Review Sub-Agent
- **Verdict:** `APPROVE`
- **T3 Provider:** `opencode`
- **Model:** `9router/gemini-3.8-flash-high`
- **Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-6103496d`
- **Target Branch / Commit:** `feat/20261024-import-drop-on-ocr` @ `d57be60`
- **Target Full SHA:** `d57be6083bc1a91c53520b6218da700b34e0d2a3`
- **Comparison Base:** `1f91409` (`Merge remote-tracking branch 'origin/main' into feat/20261024-import-drop-on-ocr`)

---

## 1. Executive Summary & Verdict

**Verdict:** `APPROVE`

The branch successfully reconciles the drag-and-drop file import capabilities from PR24 (`2d96cd8`) on top of the PR39 OCR branch (`75bf9f4`) and current main (`6045b50` via merge commit `1f91409`).

Key requirements verified:
1. **20 MB PDF Support Preserved:** Route checks in `src/lib/importFile.ts` allow PDFs up to 20,000,000 bytes (`MAX_LOCAL_PDF_BYTES`), routing them to `'document'`, preserving PR39 client-side rasterization for files > 2.9 MB.
2. **OCR Cancellation & Sequencing Preserved:** `LineImportModal.tsx` retains `ocrRequestIdRef`, `ocrAbortRef`, `cancelReading`, and unmount abort cleanup, preventing race conditions or lingering background promises.
3. **Unified Chooser & Drop Pipeline:** Both file pickers (`sheetInput`, `docInput`) and the pick screen `onDrop` target feed into `handleFile`, ensuring identical validation, routing, and user error messages.
4. **Zero Production Leaks & Zero New Dependencies:** No external network requests, no cloud credentials, and no new dependencies added (`pdfjs-dist` was already established in PR39).
5. **Clean Verification Gates:** 50/50 focused tests passed, 1764/1764 full unit tests passed, TypeScript typecheck (`tsc -b`) passed with 0 errors, oxlint passed with 0 errors, and i18n passed with every string translated.

---

## 2. Review Scope & Git Audit

The review is strictly constrained to the diff between `1f91409` and `d57be60`:
- `src/lib/importFile.ts` (new pure routing helper)
- `src/components/import/LineImportModal.tsx` (drop zone, handleFile handler, input wiring)
- `src/services/billOcr.ts` (MIME/extension fallback for empty/octet-stream types)
- `tests/import-file.test.ts` (unit tests for file routing and MIME boundary conditions)
- `src/i18n/en.ts` (translation strings for import error states)

### TDD Commit Integrity
- **RED Commit (`f3d133d`):** Added tests in `tests/import-file.test.ts` asserting 3 MB to 20 MB PDFs route to `{ kind: 'document' }` instead of `{ error: 'too-big' }`. Confirmed that this commit failed prior to the constant update due to the legacy 2.9 MB cap.
- **GREEN Commit (`acf2949`):** Updated `src/lib/importFile.ts` to use `MAX_LOCAL_PDF_BYTES` and exported it, passing all tests.

---

## 3. Test & Build Evidence

Executed using this branch's node_modules (matching PR39 dependencies):

| Check | Command | Result |
|---|---|---|
| **Focused Vitest** | `npx vitest run tests/import-file.test.ts tests/bill-ocr.test.ts tests/bill-ocr-client.test.ts tests/ocr-fill.test.ts tests/import-review.test.ts` | **5 files passed, 50 tests passed** (0 failed) |
| **Full Unit Suite** | `npx vitest run` | **145 files passed, 1764 tests passed** (0 failed) |
| **TypeScript** | `npx tsc -b` | **0 errors** |
| **Linter** | `npx oxlint tests/import-file.test.ts src/lib/importFile.ts src/services/billOcr.ts src/components/import/LineImportModal.tsx` | **0 errors, 0 warnings** |
| **Localization** | `npm run -s i18n:check` | **✓ every Thai UI string is translated** |

---

## 4. Adversarial Attacks & Trust Boundary Analysis

### Attack 1: File.type vs Extension Conflict & Spoofing
- **Location:** `src/lib/importFile.ts:18-30`
- **Scenario A (Extension Spoofed Image `bill.jpg` with `text/plain` MIME):**
  - Code: `IMAGE = (f) => f.type.startsWith('image/') || ((!f.type || f.type === 'application/octet-stream') && /\.(jpe?g|png|webp)$/i.test(f.name))`
  - Result: Because `type` is non-empty and does not start with `image/` nor match `octet-stream`, `IMAGE(f)` evaluates to `false`. Returns `{ error: 'unsupported' }`. Attack blocked.
- **Scenario B (Extension Spoofed PDF `bill.pdf` with `text/csv` MIME):**
  - Code: `sheet = SHEET_NAME.test(f.name) || SHEET_TYPE.test(f.type)`
  - Result: `SHEET_TYPE.test('text/csv')` evaluates to `true`. File is routed to `{ kind: 'sheet' }`. Downstream `parseSheetLines` attempts parsing the array buffer; if bytes are invalid PDF binary rather than CSV/XLSX, parser cleanly throws and displays an in-modal error without crashing.
- **Scenario C (Extension Spoofed Image `bill.png` with `application/pdf` MIME):**
  - Code: `PDF = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)`
  - Result: Evaluates to `true` on MIME `application/pdf`. Routed to `{ kind: 'document' }`. Downstream in `readDocumentFileNow` (`src/services/billOcr.ts:232`), `file.type === 'application/pdf'` matches; passed to pdfjs which safely rejects invalid PDF stream with `pdf_unreadable`. Attack blocked.

### Attack 2: >10 MB Image vs 20 MB PDF Bypass
- **Location:** `src/lib/importFile.ts:33-39`, `src/services/billOcr.ts:232-268`
- **Scenario (Oversized 15 MB Image Disguised as `.pdf`):**
  - An attacker renames a 15 MB JPEG to `invoice.pdf` (MIME `image/jpeg`).
  - In `routeImportFile`: `PDF(f)` matches on extension. Since 15 MB <= `MAX_LOCAL_PDF_BYTES` (20 MB), it routes to `{ kind: 'document' }`.
  - In `readDocumentFileNow` (`src/services/billOcr.ts:232`): `/\.pdf$/i.test(file.name)` matches. Since file > 2.9 MB, `renderAndReadPages()` calls `renderPdfPagesToImages(file)`.
  - Inside `pdfRaster.ts`: `pdfjs.getDocument` attempts to parse the JPEG bytes as PDF and throws. Handled as `OcrAppError('pdf_unreadable')`, resulting in localized message *"ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ"*.
  - Result: Memory is bounded; image is never sent to Gemini/OCR endpoint; execution terminates cleanly.

### Attack 3: Busy State, Drop Rejection & Race Cancellation
- **Location:** `src/lib/importFile.ts:27`, `src/components/import/LineImportModal.tsx:113-118, 148, 201-209`
- **Scenario A (Drop Event While Reading / Busy):**
  - When `step === 'reading'`, the `{step === 'pick'}` wrapper containing `onDragOver` and `onDrop` is unmounted (`LineImportModal.tsx:201`).
  - Even if triggered via synthetic event or if `busy` prop is active, `routeImportFile(file, { busy: step === 'reading' || busy })` returns `{ error: 'busy' }`, setting error to *"ระบบกำลังทำงาน"*.
- **Scenario B (Cancel In-Flight OCR):**
  - Clicking "ยกเลิก" during reading triggers `cancelReading()` (`LineImportModal.tsx:113`): increments `ocrRequestIdRef.current`, aborts `ocrAbortRef.current`, clears the controller, and resets step to `'pick'`.
  - If a background promise resolves or rejects later, `ocrRequestIdRef.current !== reqId` guards in `pickDocument` (`LineImportModal.tsx:130, 136`) discard the outcome silently.

### Attack 4: Same-File Reselection Bug / Limitation
- **Location:** `src/components/import/LineImportModal.tsx:198-199`
- **Finding:**
  ```tsx
  <input ref={sheetInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
  <input ref={docInput} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
  ```
  Neither file input clears its value (`e.target.value = ''`).
- **Impact:** If a user selects a file using the file chooser button that results in an error (e.g. empty file error: "ไฟล์ว่างเปล่า"), and then tries to select the exact same file path again via the picker button, the browser's native `onChange` event will not fire.
- **Classification:** Minor pre-existing UX limitation from `1f91409`. Drag-and-drop (`onDrop`) is completely immune as it does not rely on an `<input>` element. Non-blocking.

### Attack 5: Service-to-Pure-Lib Import Coupling (`MAX_LOCAL_PDF_BYTES`)
- **Location:** `src/lib/importFile.ts:7`
- **Finding:**
  `src/lib/importFile.ts` imports `MAX_LOCAL_PDF_BYTES` from `../services/billOcr`.
- **Transitive Dependency Audit:**
  - `importFile.ts` -> `billOcr.ts` -> `poImages.ts` -> `../backend/index.ts` -> `../backend/local.ts` -> `window.addEventListener('storage')`.
  - **Cycle Check:** No circular dependency exists (`billOcr.ts` does not import `importFile.ts`).
  - **Eager PDF Bundle Check:** No eager heavy bundle. `pdfjs-dist` is imported dynamically inside `pdfRaster.getPdfJs()` (`await import('pdfjs-dist')`); only the worker URL string is imported statically.
  - **Backend Side Effects:** Importing `billOcr` transitively executes `backend/index.ts` at module evaluation time. This required `tests/import-file.test.ts:6` to stub `window`:
    `vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })`.
- **Classification:** Architectural smell (pure `lib/` depending on stateful `services/`), but benign in client runtime because `LineImportModal.tsx` already imports `billOcr.ts`. Non-blocking for this PR.

### Attack 6: Boundary Tests Authenticity Check
- **Location:** `tests/import-file.test.ts:11-100`
- **Finding:**
  - The test suite uses lightweight JavaScript descriptors `f = (name, type, size) => ({ name, type, size })` and `new File(['fake-image-bytes'], ...)` with dummy payload strings.
  - **Confirmation:** These tests verify routing logic and initial boundary checks in `readDocumentFileNow` without making network requests or invoking cloud OCR endpoints.
  - **Explicit Note:** **No claim of cloud OCR PASS is made or implied by these unit tests.** Real OCR execution depends on Gemini/Workers AI cloud endpoints (which remain strictly isolated in staging/production).

---

## 5. File:Line Citation Index

- `src/lib/importFile.ts:7`: Import of `MAX_LOCAL_PDF_BYTES` from `../services/billOcr`.
- `src/lib/importFile.ts:20-21`: Extension and MIME boundary regular expressions for PDF and images.
- `src/lib/importFile.ts:33-39`: Size boundary checks (`MAX_SHEET_BYTES = 10MB`, `MAX_LOCAL_PDF_BYTES = 20MB`, `MAX_IMAGE_BYTES = 10MB`).
- `src/components/import/LineImportModal.tsx:146-159`: Unified `handleFile` routing and localized error mapping.
- `src/components/import/LineImportModal.tsx:198-199`: Hidden file inputs for sheets and documents.
- `src/components/import/LineImportModal.tsx:205-208`: Drag-and-drop `onDrop` handler routing first dropped file to `handleFile`.
- `src/services/billOcr.ts:214-215`: Definition of `MAX_LOCAL_PDF_BYTES = 20_000_000`.
- `src/services/billOcr.ts:292`: Image MIME extension fallback for empty string and `application/octet-stream`.
- `tests/import-file.test.ts:6`: `vi.stubGlobal('window', ...)` workaround for transitive backend dependency.
- `tests/import-file.test.ts:70-79`: 3 MB - 20 MB PDF test cases verifying document routing.
