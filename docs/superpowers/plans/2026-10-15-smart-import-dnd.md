# Smart text import and drag and drop for the import window

> For agentic workers: use superpowers:executing-plans inline (Owner policy: no native subagents). Steps use `- [ ]` tracking.

Goal: the shared import window (`src/components/import/LineImportModal.tsx`) accepts dropped files and typed or pasted product lists, and never loses a review when saving fails.

Architecture: three pure modules carry every rule so they can be unit tested: `lib/itemText.ts` reads free text into the existing `ReadLine` shape, `lib/importFile.ts` decides what a dropped or picked file is, and `lib/importReview.ts` gains `setQty`. The modal only wires them. Text lines go through the same `planRows` / `importable` / `blockedReason` path as files, so a guess still needs a person.

Tech: React 19, TypeScript, Vitest (node), Playwright in demo mode (`playwright.import.config.ts`, port 5192, browser storage only).

Spec: Owner brief "T3 — Smart Import + Drag & Drop for Purchase Requests", 15 Oct 2026, sections A to F.

## Global constraints

- Never invent a product, supplier, quantity, unit conversion or SKU. Unknown unit stays `unit-unknown`; missing quantity stays `bad-qty` until a person types one.
- Only SKU, confirmed alias and one exact name are pre-ticked (`planRows`). Every fuzzy or word match waits for a person.
- Text never approves, sends to a supplier, or posts stock. Prohibitions in the text ("ยังไม่ต้องส่งผู้ขาย") are kept and shown.
- Reuse `parseSheetLines`, `readDocumentFile`, `planRows`, `blockedReason`, `importable`, `convertFor`. No new OCR or import service. PDF limit stays `MAX_PDF_BYTES` in `services/billOcr.ts`.
- Spreadsheet files: `.xlsx`, `.xls`, `.csv`. Documents: `image/*`, `.pdf`, only when `billReaderAvailable()`.
- Do not close the window when `onImport` resolves `false` or throws; keep rows, ticks and text.
- No new Firestore reads. ThaiTrees is not a dependency.
- TH/EN for every new string (`src/i18n/en.ts`), `npm run i18n:check` green.

## Review focus

1. A drop while a file is still being read: ignored, one read only. Test in Task 2 (`routeImportFile` busy) and the browser suite.
2. A file dropped outside the drop zone but inside the window: the browser must not navigate away. Browser test in Task 4.
3. Quantity written before the name ("2 x mozzarella", "5 ถุง แป้ง"), and a number that is part of the name ("กล่องพิซซ่า 18 นิ้ว 2 แพ็ค"). Tests in Task 1.
4. A line that is only an instruction ("ยังไม่ต้องส่งผู้ขาย"): not an item. Test in Task 1.
5. `RequestEditor` where every chosen product has no supplier: nothing is added, so the window stays open. Browser test in Task 4.

---

### Task 1: read free text into lines

Files: create `src/lib/itemText.ts`, `tests/item-text.test.ts`; move `UNIT_SYNONYMS` and `canonicalUnit` from `src/services/purchaseBatch.ts` to `src/lib/units.ts` (re-export from `purchaseBatch.ts`, so its callers do not change).

Produces: `readItemText(text: string): { lines: ReadLine[]; constraints: string[] }`.

- Split on new lines, `,`, `;`, `、`, and Thai `และ` / English `and` between items.
- Quantity: the last number followed by a known unit word, else a trailing bare number, else a leading `N x` / `N` before the name, else `x N` after it. A number followed by `นิ้ว`, `cm`, `"`, `%` belongs to the name. No quantity: `qty: NaN`.
- Unit: `canonicalUnit()` of the unit word, else the word as written (`ถุง`).
- Constraint: a segment containing `ไม่ต้อง`, `ห้าม`, `ยังไม่`, `อย่า`, `don't`, `do not`, `not yet` and no quantity goes to `constraints`, not `lines`.
- Tests: the Owner example gives three lines with `{name:'แป้งพิซซ่า', qty:5, unit:'ถุง'}`, `{name:'มอสซาเรลล่า', qty:3, unit:'KG'}`, `{name:'กล่องพิซซ่า 18 นิ้ว', qty:2, unit:'Pack'}`; one item per line; comma list; `2 x mozzarella`; `mozzarella x2`; English/Thai mixed; no quantity gives NaN; prohibition goes to constraints; blank and whitespace-only text gives nothing.

### Task 2: decide what a file is

Files: create `src/lib/importFile.ts`, `tests/import-file.test.ts`.

Produces: `routeImportFile(f: { name: string; type: string; size: number }, o: { documents: boolean; busy: boolean }): { kind: 'sheet' | 'document' } | { error: 'busy' | 'unsupported' | 'no-reader' | 'too-big' | 'empty' }`; `MAX_SHEET_BYTES = 10_000_000`.

- Sheet by extension `.xlsx|.xls|.csv` or the matching MIME; document by `image/*` or `.pdf`. `busy` wins. Zero bytes is `empty`. A sheet over `MAX_SHEET_BYTES` is `too-big`; a PDF over the service's limit is `too-big` (export `MAX_PDF_BYTES` from `services/billOcr.ts`). A document when `documents` is false or no reader is `no-reader`.

### Task 3: a quantity a person types

Files: modify `src/lib/importReview.ts`, `tests/import-review.test.ts`.

Produces: `setQty(r: ReviewRow, qty: number): ReviewRow` recomputes the conversion from `{ ...r.read, qty }` when there is a product, keeps `how`, and ticks only when not blocked and `how` is `sure` or `picked`.

### Task 4: the window

Files: modify `src/components/import/LineImportModal.tsx`, `src/pages/requests/RequestEditor.tsx` (return the `addFromExcel` result, `false` when nothing was added), `src/i18n/en.ts`; create `e2e/import-window.demo.ts`, `playwright.import.config.ts`; add the suite to `.github/workflows/ci.yml`.

- Pick step: one drop zone (click or Enter/Space opens the picker, `aria-describedby` hint, highlighted while dragging), the AI document button as before, and a text area with "อ่านรายการ". A window-level `dragover`/`drop` handler prevents navigation while the window is open.
- A ref guards against a second read while one is running.
- Review: constraint banner; a quantity input on rows blocked by `bad-qty`; "เลือกไฟล์อื่น" keeps the text.
- `confirm()`: close only when `onImport` resolves to something other than `false`; on `false` or an error keep everything and show the error.
- Browser tests (demo data, three brands untouched): Owner text example reaches review with no row ticked unless sure; CSV drop; XLSX drop; unsupported `.txt` drop shows the message; image and PDF drop without the AI reader show "ใช้ได้บนระบบจริงเท่านั้น"; drop during reading reads once; drop outside the zone keeps the URL; all-no-supplier import keeps the window open with rows; English labels.

### Task 5: verify and hand over

`npm test`, `npx tsc -b`, `npm run lint`, `npm run i18n:check`, `npm run build`, main CI bundle budget, both demo suites, then regression of Orders/Adjust/MonthlyCount/LineBuilder callers by typecheck plus the existing E2E in CI. Evidence in `docs/evidence/smart-import/README.md`, draft PR, independent OpenCode review on the exact head.
