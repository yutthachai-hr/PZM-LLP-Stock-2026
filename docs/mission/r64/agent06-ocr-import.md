# R64 Agent 06: OCR & Import Verification Report

## 1. Executive Summary & Git Identity

| Field | Value |
|---|---|
| **Mission / Agent** | R64 AGENT06 OCR & IMPORT |
| **Isolated Worktree** | `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-b6bcf51c` |
| **Clean Branch** | `t3/ocr-import-review` |
| **Base Commit (main)** | `312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55` (`main312f8a7`) |
| **Merged Branch Commit** | `75bf9f47cb3b5f2b07c173a73dadbce84de1403a` (`origin/fix/20261019-ocr-reader-resilience`) |
| **Merge Commit** | `66af84e68e4bf2b1d3ef64fc674f1dcaab845c48` (Merge made by 'ort' strategy, 0 conflicts) |
| **Review Verdict** | **APPROVED** (Code review + synthetic test suite passed) |
| **Live Staging Status** | **BLOCKED** (Staging project & AI bindings not yet provisioned; prod test forbidden) |

---

## 2. Fixture Verification: 31-Row Bill & Missing Quantity Rows

Ground truth fixture: `tests/fixtures/ocr/synthetic-31-groundtruth.json`.

### Row Counts & Survival Audit

| Metric | Expected (Ground Truth) | Actual (cleanOcr / Parsing) | Actual (LineImportModal / planRows) | Actual (Receive / ocrFill) | Status |
|---|---|---|---|---|---|
| **Total Rows** | 31 | 31 | 31 | 31 (under `skipped`) | **VERIFIED** |
| **Numeric Rows** | 28 | 28 (exact numbers) | 28 (un-ticked, how: null or guess) | 28 (`why: 'noProduct'`) | **VERIFIED** |
| **Manual / Missing Qty Rows** | 3 (Rows 9, 17, 26) | 3 (`qty: 0`) | 3 (`qty: 0`, blocked: `'bad-qty'`) | 3 (`why: 'noQty'`) | **VERIFIED** |
| **Silent Drops** | 0 | 0 | 0 | 0 | **VERIFIED** |
| **Auto-Ticked / Pre-Imported** | 0 | 0 | 0 | 0 (`filled: 0`) | **VERIFIED** |

### Breakdown of the 3 Manual Rows (R58 Fix in 75bf9f4)

1. **Row 9:** `"พริกหวานสามสีรวม (Mixed Bell Peppers Tri-color)"` — ground truth `orderQty: "-"`
   - `cleanOcr`: kept at `qty: 0` (was previously dropped in prior code where filter was `qty > 0`).
   - `LineImportModal`: displayed with warning `"จำนวนในไฟล์ใช้ไม่ได้"` (`blockedReason === 'bad-qty'`). The row checkbox is **disabled** (`disabled={blocked !== null}`).
   - `importReview`: `blockedReason` returns `'bad-qty'`. Calling `setInclude(row, true)` refuses to tick the row (`include: false`). `importable(rows)` excludes it.
   - `Receive` (`ocrFill`): listed in `skipped` as `"พริกหวานสามสีรวม (Mixed Bell Peppers Tri-color) — บิลไม่ได้ระบุจำนวน — คีย์จำนวนเอง"` (`why: 'noQty'`).
2. **Row 17:** `"พาร์มาแฮมบ่ม 18 เดือน (Prosciutto di Parma 18m)"` — ground truth `orderQty: "ตาม"`
   - `cleanOcr`: kept at `qty: 0`.
   - `LineImportModal`: displayed, checkbox disabled, blocked from import (`'bad-qty'`).
   - `Receive` (`ocrFill`): listed in `skipped` as `why: 'noQty'`.
3. **Row 26:** `"ครีมชีสแท้ (Cream Cheese Philadelphia 2kg)"` — ground truth `orderQty: "ตาม"`
   - `cleanOcr`: kept at `qty: 0`.
   - `LineImportModal`: displayed, checkbox disabled, blocked from import (`'bad-qty'`).
   - `Receive` (`ocrFill`): listed in `skipped` as `why: 'noQty'`.

### Trust Boundary Invariants

- **No Product Guessing / Auto-Matching from OCR:**
  - `src/lib/billOcr.ts` `ocrCandidates` strictly returns `{ matched: [], unmatched: [...bill.lines] }`.
  - `src/lib/importReview.ts` `matchOne` explicitly excludes OCR lines: `if (read.source === 'ocr') return undefined`.
  - Word-by-word suggestions from `suggestProducts` are assigned `how: 'guess'` and `include: false`. They are displayed but **never** pre-ticked.
- **No Supplier Guessing:**
  - In `Receive.tsx`, OCR read suggests `supplierName` from the bill, but if not matching an existing supplier, it remains unselected or manual (`OTHER_SUPPLIER`). The person must review or select.
- **No Fuzz Auto-Confirm:**
  - `importable(rows)` enforces `r.include && (r.how === 'sure' || r.how === 'picked') && blockedReason(r) === null`.
  - A guess is never importable until explicitly confirmed (`choose` or `setInclude`).

---

## 3. Source Findings & System Resilience

### A. PDF & Image Processing Limits

- **Direct Upload Limit (`MAX_DIRECT_PDF_BYTES`):** 2,900,000 bytes (~2.9 MB). PDFs <= 2.9 MB are sent directly as base64 to Google Gemini.
- **Local Rasterization Ceiling (`MAX_LOCAL_PDF_BYTES`):** 20,000,000 bytes (20 MB). Files > 20 MB fail immediately on the client with `pdf_too_large` (`"ไฟล์ PDF ใหญ่เกินไป (สูงสุดประมาณ 20 MB) — ลองส่งเฉพาะหน้าที่มีรายการ"`).
- **Multi-Page Fallback Ceiling (`MAX_FALLBACK_PAGES`):** 5 pages. Documents with `doc.numPages > 5` are rejected with `pdf_fallback_limit` (`"การอ่านสำรองรองรับ PDF สูงสุด 5 หน้า — ลองส่งเฉพาะหน้าที่มีรายการ"`).
- **Canvas Dimension & Memory Limits:**
  - Max dimension per page: 2,000 px (`MAX_DIMENSION`).
  - Max total pixels per page: 4,000,000 px (`MAX_TOTAL_PIXELS`).
  - Automatic scaling clamps large pages to prevent browser tab crashes on mobile/tablets.
  - Immediate canvas deallocation: in `src/lib/pdfRaster.ts`, `canvas.width = 0; canvas.height = 0;` is executed in `finally` right after `toDataURL` export.
  - Bounded resource destruction: `loadingTask.destroy()` and `doc.destroy()` are raced against a 500ms timeout in `finally`.
- **Image Downscaling:**
  - `shrinkImage` clamps images to 2,000 px on the longest side and encodes as JPEG 0.85, freeing the object URL via `URL.revokeObjectURL(url)`.

### B. CSP Worker & Decoder Formats (HEIC / JPEG2000)

- **Production CSP (`public/_headers`):**
  - Directive: `worker-src 'self'; script-src 'self' https://static.line-scdn.net;`
  - Implementation: `src/lib/pdfRaster.ts` loads the worker via Vite's URL import:
    `import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'`
    Vite emits this as a same-origin asset (`/assets/pdf.worker-[hash].mjs`), complying strictly with `worker-src 'self'` without requiring `blob:` or third-party CDNs.
  - Verified via Playwright E2E test `e2e/ocr-fallback-csp.demo.ts`.
- **HEIC & JPEG2000 Compatibility:**
  - Standalone `.heic` or `.jp2` files rely on browser-native image element decoding (`<img src>`). In Safari/WebKit, HEIC and JPEG2000 decode natively. In Chromium and Firefox, raw HEIC/JP2 image uploads fail gracefully with `"อ่านรูปไม่ได้"`.
  - Inside PDFs, JPEG2000 streams are handled by PDF.js's internal JPX decoder (`pdfjs-dist` includes `jpx.js`), avoiding browser format limitations.

### C. Timeouts, Deadlines & Client Cancellation

- **Server-Side (`functions/api/ocr-bill.ts`):**
  - `AGGREGATE_TIMEOUT_MS`: 75,000 ms (75s hard cap).
  - `PER_ATTEMPT_TIMEOUT_MS`: 40,000 ms (40s per attempt).
  - Retries: Up to 2 retries (3 total attempts) with exponential backoff + jitter for transient HTTP 500, 503, 504.
  - Non-transient errors (400, 401, 413, 415, 429) **never** retry.
  - Server listens to `request.signal` and cancels upstream fetch requests immediately on client abort.
- **Client-Side (`src/services/billOcr.ts`):**
  - `DEFAULT_HTTP_TIMEOUT_MS`: 85,000 ms (85s) for photos.
  - `DEFAULT_PDF_TIMEOUT_MS`: 150,000 ms (150s) for multi-page PDFs.
  - User Cancellation: UI provides explicit `"ยกเลิก"` buttons in `LineImportModal.tsx` and `Receive.tsx` (`DocumentCard.tsx`), backed by `AbortController` and request ID generation counters (`ocrRequestIdRef`) to safely ignore late network responses.

---

## 4. Test Commands & Verification Results

### Focused Test Suite (Synthetic Fixtures & Isolated Logic)

Command:
```bash
npx vitest run \
  tests/ocr-fixture-31.test.ts \
  tests/bill-ocr.test.ts \
  tests/bill-ocr-client.test.ts \
  tests/ocr-bill-function.test.ts \
  tests/ocr-fill.test.ts \
  tests/import-review.test.ts \
  tests/import-stock.test.ts \
  tests/count-import.test.ts \
  tests/barcode-import.test.ts \
  tests/supplier-import.test.ts \
  tests/request-pdfmake.test.ts \
  tests/export-pdf.test.ts \
  tests/export-pdf-layout.test.ts
```

Output:
```
Test Files  13 passed (13)
     Tests  147 passed (147)
  Duration  10.10s
```

### Static Analysis & Types

- `npx tsc --noEmit`: **0 errors** (clean pass).
- `npm run lint` (`oxlint`): **0 errors** in touched files.
- `npm run i18n:check`: **Clean pass** (`✓ every Thai UI string is translated`).

---

## 5. Preview & Staging Environment Status

### Preview Isolation
- Endpoint `/api/ocr-bill` returns HTTP 503 `{"error": "not_configured"}` in Preview environments because `GEMINI_API_KEY` is withheld by design.
- **Integrity Rule:** This isolation is intentional. We do not weaken or bypass this check, and do not mock Preview as a passing real-OCR test.

### Staging Status: BLOCKED
- Real Cloudflare Pages staging project with `GEMINI_API_KEY` secret and `[ai]` Workers AI binding is **not yet provisioned**.
- In accordance with safety policies, testing against production or writing real business receipts is strictly prohibited.
- Staging execution is formally marked as **BLOCKED**.

### Isolated-Staging QA Matrix (To execute once Staging is provisioned)

| Test ID | Scenario | Input / Action | Expected Result | Pass Criteria |
|---|---|---|---|---|
| **STG-OCR-01** | 31-Row Synthetic Bill | Upload `synthetic-31-text.pdf` | 31 rows displayed; 28 with quantities; rows 9, 17, 26 displayed with qty 0 | No dropped rows; rows 9, 17, 26 marked `"จำนวนในไฟล์ใช้ไม่ได้"` and cannot be ticked |
| **STG-OCR-02** | Missing Qty Manual Override | In import review, pick product for Row 9 and attempt import | Row remains unticked and blocked | Modal prevents confirmation of 0-qty lines until qty keyed |
| **STG-OCR-03** | Product Review Trust Boundary | Upload clear bill with known product names | Lines matched as `how: 'guess'`, un-ticked | Zero lines automatically imported without human click |
| **STG-OCR-04** | User Cancellation | Upload multi-page PDF, press `"ยกเลิก"` at 2s | In-flight request aborted | UI returns to idle/pick state; late response ignored |
| **STG-OCR-05** | Upstream Timeout | Simulate 504 / slow network (>85s) | Client aborts with typed error | Shows `"การเชื่อมต่อ AI หมดเวลา — ลองใหม่อีกครั้ง หรือคีย์เอง"` |
| **STG-OCR-06** | Multi-Page PDF (>5 Pages) | Upload 6-page PDF document | Immediate client rejection | Shows `"การอ่านสำรองรองรับ PDF สูงสุด 5 หน้า"` |
| **STG-OCR-07** | Large PDF (>20 MB) | Upload 21 MB PDF file | Immediate client rejection | Shows `"ไฟล์ PDF ใหญ่เกินไป (สูงสุดประมาณ 20 MB)"` |
| **STG-OCR-08** | Mobile & Tablet Layout | Test at 838px (iPad portrait) and 1024px | Document card and action buttons stack cleanly | No overlapping buttons, horizontal scroll, or hidden inputs |

---

## 6. Future PR24 (`feat/smart-import-dnd`) Coordination

Branch `feat/smart-import-dnd` (PR24) introduces drag-and-drop file import and text pasting (`LineImportWindow.tsx`).

### Documented Overlap & Merge Guidance

1. **`src/services/billOcr.ts`:**
   - PR24 adds MIME type fallback for drag-and-drop files lacking standard MIME headers:
     `const isImage = file.type.startsWith('image/') || ((!file.type || file.type === 'application/octet-stream') && /\.(jpe?g|png|webp)$/i.test(file.name))`
   - When integrating, retain this extension check inside PR39's `readDocumentFileNow`.
2. **`src/components/import/LineImportModal.tsx` vs `LineImportWindow.tsx`:**
   - PR24 replaces `LineImportModal.tsx` with a re-export of `LineImportWindow.tsx`.
   - PR39 adds AbortController hooks (`ocrAbortRef`, `ocrRequestIdRef`, `cancelReading()`) and stamps `{ source: 'ocr' }` on parsed lines.
   - These abort controls and OCR source tags must be ported into `LineImportWindow.tsx`.
3. **`src/lib/importReview.ts` (`setQty` Synergy):**
   - PR24 introduces `setQty(r: ReviewRow, qty: number): ReviewRow`.
   - This directly complements PR39: when PR39 preserves the 3 missing-qty rows at `qty: 0`, PR24's UX provides the exact input mechanism for the person to type the missing quantity and unblock the row for import.

---

## 7. Rollback & Revert Procedure

If any issue arises from merging `origin/fix/20261019-ocr-reader-resilience`, revert cleanly:

```bash
# To revert the merge commit in the local branch:
git revert -m 1 66af84e68e4bf2b1d3ef64fc674f1dcaab845c48

# Or to reset branch to origin/main:
git reset --hard 312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55
```
