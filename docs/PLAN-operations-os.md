# PZM OPERATIONS OS: Audit สภาพปัจจุบันของ PZM Stock (6 ต.ค. 2026)

## Context

เจ้าของขอ audit ครบทุกด้าน (product, UX, architecture, data, operations, intelligence) ของแอปจริง **ก่อน** ลงมือทำอะไร ลำดับความสำคัญตามที่สั่ง: DATA CORRECTNESS → WORKFLOW → EFFICIENCY → EXCEPTIONS → OBSERVABILITY → INTELLIGENCE → AUTOMATION → AUTONOMY และ **"ห้ามวาง AI automation บนข้อมูลที่ยังไม่น่าเชื่อถือ"**

ไฟล์นี้คือรายงาน audit **ยังไม่มีการแก้โค้ดใดๆ** ทุกข้อมาจากการอ่านซอร์สในตอนนี้ (อ้าง `file:line`) ข้อที่สำคัญที่สุดตรวจซ้ำกับโค้ดจริงแล้ว ได้แก่ `incomingFor`, `receivePurchaseOrder` สองขั้น, rule `transferId` และ rule `requestEdit`

**รอบแก้ที่ 2 (ตามความเห็นเจ้าของ 9 ข้อ):**
- เพิ่ม ADR "trusted command boundary" (ข้อ 15A)
- A1 ใช้ operationId + เอกสาร deterministic
- A2 ใช้สูตร base-unit พร้อม legacy fallback
- E1 ไม่นับ PR approved เป็น Reserved
- A6 เปลี่ยนเป็น idempotent conversion
- เพิ่ม Integrity Auditor (เฟส A0) ก่อน AI
- เพิ่ม Playwright + concurrency ใน exit gate
- Notification เปลี่ยนเป็น KEEP + IMPROVE
- ทุกเฟสมี exit criteria ที่วัดได้ (ข้อ 21)

**กติกาความปลอดภัยที่ยึดตลอด:** main = production ห้าม auto-merge ห้ามทดสอบแบบทำลายบน production การทดสอบ write ทำบน `npm run demo` (local backend) เท่านั้น

**งานค้าง (แยกจาก audit):**
- branch `fix/import-review` มีการแก้หน้ารีวิวนำเข้าที่ยังไม่ commit (`productSuggest.ts` + การ์ด ReviewRow)
- tsc และ i18n ผ่านแล้ว ยังต้องรัน vitest/lint/build แล้ว commit
- **จะไม่ merge จนกว่าเจ้าของสั่ง** (ตามกติกาใหม่ "Do not auto-merge")

**ตัวย่อในตาราง:** แอดมิน = admin, หัวหน้า = manager, พนักงาน = staff · ผลกระทบ (I): C = Critical, H = High, M = Medium, L = Low · ขนาดงาน (E): S / M / L / XL

---

## 1. Feature Registry

| พื้นที่ | Route / ไฟล์หลัก | บทบาท | หน้าที่ | ผลประเมิน |
|---|---|---|---|---|
| หน้าแรก | `/` `Dashboard.tsx`, `PhoneHome.tsx`, `components/dashboard/*` | ทุกคน (DailySuggestions เฉพาะหัวหน้า/แอดมิน) | KPI 5 ตัว, คำแนะนำ, ความเสี่ยงการส่ง, ของใกล้หมด, กิจกรรม | IMPROVE: คำนวณซ้ำ, ไม่มี empty/error state |
| สินค้า/สต๊อก | `/products` `Products.tsx`, `products/*` | ทุกคน, แก้ได้เฉพาะแอดมิน | แคตตาล็อก + ยอด, filter, export, ตั้ง min, WIP, barcode | KEEP / IMPROVE: delete และ reset ไม่มี audit |
| Stock card | `/products/:id/card` | ทุกคน | ยอดเข้า/ออก/ปรับ + กราฟ | KEEP: ต้องแบ่งหน้า |
| รับเข้า | `/receive` `Receive.tsx`, `receive/*` | ทุกคน | 3 โหมด po/manual/kitchen, OCR บิล, ตรวจบิลซ้ำ | **REBUILD core write** (ไม่ atomic), UX KEEP |
| เบิก/โอน | `/issue` `Issue.tsx`, `issue/PosImport.tsx` | ทุกคน (โอนตรงเฉพาะหัวหน้า) | เบิกใช้, โอนตรง, ตัดตาม POS | SIMPLIFY: โหมดโอนของพนักงานเป็นทางตัน |
| ปรับสต๊อก | `/adjust` | ทุกคน | นับหรือ delta พร้อมเหตุผล | IMPROVE: ไม่มีรูป, rules ไม่บังคับ enum เหตุผล |
| นับประจำเดือน | `/counts`, `/counts/:id` | นับ: ทุกคน; post: หัวหน้า | นับ → record/post เป็น adjust | IMPROVE: diff คำนวณฝั่ง client, ไม่ใช่ blind count, ไม่มี period lock |
| ประวัติ | `/movements` | อ่าน: ทุกคน; edit/void: แอดมิน (rules ให้ทุกคน edit) | ledger + filter | IMPROVE: void ไม่มีเหตุผล, ไม่มีหน้าแบ่ง |
| รายงาน | `/reports` 5 แท็บ | ทุกคน | ภาพรวม, คงเหลือ, เคลื่อนไหว, ต้นทุน, activity log | IMPROVE: activity log ขาด master data |
| นำเข้ายอดเปิด | `/import` | แอดมิน | Excel ปิดเดือน/แคตตาล็อก | MERGE เข้า import hub |
| ขอสั่งซื้อ (PR) | `/requests*` | สร้าง: ทุกคน; review: หัวหน้า | draft → approve → แปลงเป็น PO → LINE | **IMPROVE critical**: convert ไม่ atomic, แก้ items หลัง approve ได้ |
| ใบสั่งซื้อ (PO) | `/orders` `Orders.tsx` (1,399 บรรทัด) | ทุกคน | สร้าง/ส่ง/แก้/ยกเลิก/ปิดยอด, supplier confirm | IMPROVE: พนักงานสร้าง `ordered` ได้เลย ไม่ผ่านอนุมัติ, แตกไฟล์ |
| Batch Excel | `/purchase*` | ไม่มี gate ที่ route | Excel บริษัท → draft PO ต่อผู้ขาย | MERGE กับ PR (ซ้อนกับ RequestExcelImport) |
| ผู้ขาย | `/suppliers`, `SupplierDetail` | อ่าน: ทุกคน; แก้: แอดมิน | ผู้ขาย × สินค้า × ราคา | IMPROVE: ไม่มี audit, ข้อความยืนยันลบผิด |
| ผลงานผู้ขาย | `/suppliers/performance` | ทุกคน | on-time, fill-rate | KEEP: ตารางกว้าง 920px บนมือถือ |
| โอน/โลจิสติกส์ | `/transfers*` (5 routes) | ทุกคน, approve เฉพาะหัวหน้า | request → approve (→ Transit) → รับ → discrepancy/misroute | KEEP (ดีที่สุดในระบบ) / IMPROVE: ไม่มีตรวจค้างในทาง |
| สูตร/WIP | `/recipes` (ไม่อยู่ใน nav) | ดู: ทุกคน; แก้: หัวหน้า | สูตรสำหรับตัด POS | IMPROVE: หาไม่เจอ |
| ปฏิทิน/งาน | `/calendar` | ทุกคน, จัดการงานเฉพาะหัวหน้า | งาน, PO ที่จะมา, PR, ของใกล้หมด | KEEP |
| ประกาศ | `/announcements*` | เขียน: หัวหน้า | ประกาศเลขที่ → PDF → LINE | KEEP |
| แจ้งเตือน | Bell, NotificationHost, prefs, `Toast.tsx` | ทุกคน | listener เดียว, popup 4 วินาที, dedupe `<kind>__<subject>`, burst collapse, เสียงตาม severity | **KEEP + IMPROVE** (C5): critical หายไปพร้อมกับ popup อื่นแล้วไม่มีที่ค้างไว้, toast error หายใน 4 วินาทีและไม่มี aria-live, toast ทับ tab bar, deep action ยังเป็นแค่ลิงก์ ไม่มีปุ่มทำงานในตัว |
| ข้อความกะ | MessagesButton | ทุกคน | กระดานโน้ต | KEEP |
| หน้าผู้ขาย | `supplier.html`, `/api/supplier/:token` | public (signed token) | ยืนยัน/เสนอวันส่ง | KEEP |
| LINE share | `src/share/*` | ทุกคน | LIFF shareTargetPicker + resume | KEEP |
| OCR | `/api/ocr-bill` + `LineImportModal` (7 หน้า) | ผู้ใช้ที่มี token | รูป/PDF/Excel → แถวสินค้า | IMPROVE: auth ไม่เช็ค active |
| Settings | 16 sections (`Settings.tsx:130-170`) | ส่วนใหญ่แอดมิน | ดูข้อ 13 | SIMPLIFY: maintenance tools ไม่มี confirm/audit |
| Background | Worker cron (ยังไม่ deploy), `useAutomation` fallback ในเบราว์เซอร์หัวหน้า | — | งานเตือน, insights, สร้างงานนับ | IMPROVE: fallback ล้มเงียบ |

**Import มี 9 ทาง:** Import, PurchaseImport, RequestExcelImport, CountImport, PosImport, BarcodeImport, LineImportModal, supplier link import, backup restore
**Export มี 11 จุด:** Excel ทุกหน้ารายงาน, PDF A5 สำหรับ PO, PDF ประกาศ

## 2. Workflow Map (สภาพจริง)

```
PR (ทุกคน) ─submit→ pendingApproval ─หัวหน้า→ approved ─convertToOrders (ไม่ atomic)→ PO ordered ─LIFF→ LINE ผู้ขาย
                                             ↑ items ยังแก้ได้ (rules)
PO ordered ก็สร้างตรงได้ (ทุกคน, ไม่ผ่าน PR/อนุมัติ) · Batch Excel → draft PO → approve (ใครก็ได้)
ผู้ขาย ─signed link→ ยืนยัน/เสนอวัน → expectedAt / pending_date_approval → หัวหน้า decide
ส่งของ → /receive โหมด po: receiveStock (tx) ─แล้ว→ db.update(PO) (แยก write) → stockMovements + stockLevels
         ขาด: เก็บเป็น ordered หรือ closeRemainder  เกิน: รับไม่จำกัด  เสีย/ปฏิเสธ: ไม่มีฟิลด์
โอน: request → หัวหน้า approve (ต้นทาง → Transit ใน tx) → รับ (Transit → ปลายทาง, min(รับ, คาด)) → discrepancy → resolve (หัวหน้า)
เบิก/POS/ปรับ → movement + level ใน tx เดียว (ดี)
นับเดือน → diff (client) → หัวหน้า post เป็น adjust (chunk 200, postedIds กันซ้ำ)
Analytics: insights / reorder / shortageRisks ← onHand + incomingFor (นับ orderedQty เต็ม) ← ไม่มี reserved
```

## 3. UX Friction (เรียงตามแรงที่เสีย)

1. **Transfer อยู่ 3 ที่** (Issue, `/transfers`, `/transfers/today`) พนักงานที่เลือกโหมดโอนใน Issue เจอการ์ดให้ไปที่อื่น
2. **Import กระจาย 9 ทาง** มี 3 ทางที่ซ้อนกันสำหรับการสั่งซื้อ: "ขอสั่งซื้อ", "ขอสั่งซื้อจากใบสั่งของบริษัท", "สร้างใบสั่งซื้อจาก Excel"
3. **รับของจาก PO ใช้ราว 6 ขั้น** และจำนวนไม่ prefill (ต้องกด "รับครบตาม PO")
4. **หน้ากว้างบนมือถือ:** RequestReview 1080px, WorkbookRows 960, SupplierPerformance 920, Adjust/ReportsOverview 640
5. **Toast และ UpdateBanner ทับ tab bar** บนมือถือ (`Toast.tsx:52`)
6. **`/recipes`, `/purchase` ไม่อยู่ใน nav** และ role gate ของ `/purchase` ไม่ตรงกันระหว่าง dashboard กับปุ่มใน Orders
7. **ไม่มี empty/error state:** Dashboard cards, Issue, Adjust, Receive, PurchaseImport, ReportsOverview
8. **Toast error หายใน 4 วินาที** และไม่มี `aria-live`
9. **ตาราง Movements, StockCard, Cost, Suppliers, Transfers, Recipes ไม่แบ่งหน้า** และ DataTable render ทั้งการ์ดและตาราง (DOM ซ้ำ 2 เท่า)
10. **UX-lab มี 15 issue เปิดอยู่** (`docs/ux-lab/ledger.json`) เช่น UX-0001 ค้นภาษาไทยไม่เจอ (blocker), UX-0011 หน้าแก้สินค้าเป็น read-only โดยไม่บอก (blocker)

## 4. Duplicate-Work Analysis

| คีย์ซ้ำ | ที่ไหน | แก้ทาง |
|---|---|---|
| PR → PO ไม่พา note, urgency, line note, approvalNote ไป | `purchaseRequests.ts:732-779` | พาไปด้วย |
| หน่วยถูกคำนวณใหม่ที่อัตราปัจจุบัน ไม่ใช่อัตราตอนอนุมัติ | `purchaseOrders.ts:271` | snapshot อัตราตอนอนุมัติ |
| รับของไม่ prefill qty | `receipt.ts:49-56` | prefill ยอดค้าง + แก้เฉพาะข้อยกเว้น |
| Excel ใบสั่งบริษัทเข้าได้ 2 ทาง (Batch และ RequestExcelImport) | `purchase/*`, `requests/RequestExcelImport` | ทางเดียว: เข้า PR |
| เลข invoice/เอกสารพิมพ์เองทุกครั้ง ทั้งที่ OCR อ่านได้ | `DocumentCard` | OCR เติมเลขบิลและวันที่ (มีบางส่วนแล้ว) |
| โอน: พนักงานกรอกใน Issue แล้วต้องไปกรอกใหม่ใน TransferEditor | `Issue.tsx:225` | ส่ง draft ข้ามหน้า หรือเอาโหมดออก |

## 5. Data Integrity Risks (หัวใจของ audit)

| # | ความเสี่ยง | หลักฐาน | I |
|---|---|---|---|
| D1 | **รับของ 2 write แยกกัน:** stock ลง tx แล้ว PO update แยก ถ้าขั้นที่ 2 ล้ม stock เข้าแล้วแต่ PO ยังค้าง → retry เข้าซ้ำ; 2 เครื่องรับ PO เดียวกัน stock เข้า 2 รอบ | `purchaseOrders.ts:562` (อ่านนอก tx), `:627-642`, `:674` | **C** |
| D2 | **`incomingFor` นับ orderedQty เต็ม ไม่หัก receivedQty** PO ที่รับบางส่วนถูกนับซ้ำทั้งใน On Hand และ Incoming → สั่งขาด / เตือนหมดช้า | `inventoryRules/purchasing.ts:92-104` | **C** |
| D3 | **แก้/void movement ที่มี poId ไม่ sync กลับ PO** ledger กับ PO บอกคนละอย่าง | `stock.ts:972-1138`, `:1269-1316` | H |
| D4 | **convertToOrders ไม่ atomic:** กดซ้อนได้ PO ชุดซ้ำ; ล้มกลางทางได้ PO กำพร้าและ PR ค้าง `approved` ที่ retry ไม่ได้ | `purchaseRequests.ts:740-769` | H |
| D5 | **amend/cancel/closeRemainder อ่านแล้วเขียนนอก tx** amend จาก read เก่าทับ `receivedQty` ที่เพิ่งรับได้ | `purchaseOrders.ts:422-473`, `:756-784`, `:685-710` | H |
| D6 | **ไม่มี period lock** แก้หรือ backdate movement เข้าเดือนที่ post นับไปแล้ว | — | H |
| D7 | **diff ของการนับคำนวณฝั่ง client** ไม่คำนวณใหม่ใน tx; movement ที่เข้ามาระหว่าง review กับ confirm ทำให้ adjust ผิด | `MonthlyCountSheet.tsx:119,144,225` | H |
| D8 | **รับเกินไม่จำกัด, ไม่มี rejected/damaged qty, เหตุผลเป็น free text** | `purchaseOrders.ts:581-591`, `:501-508` | M |
| D9 | **recompute/rebuild levels ไม่ใช่ tx** (เช็ค drift ครั้งเดียวก่อนเขียน) | `stock.ts:1431-1473`, `:1234-1257` | M |
| D10 | **ลบสินค้า/สถานที่ ลบ stockLevels แต่ ledger ยังชี้อยู่** recompute จะสร้างยอดกลับมาให้ master ที่ไม่มีแล้ว | `products.ts:168-176`, `locations.ts:26-32` | M |
| D11 | **ไม่มี Reserved/Available** purchase suggestion ไม่หักของที่ผูกกับการโอน | `reorder.ts:40`, `suggestions.ts:120-130` | M |
| D12 | **legacy PO line ที่มี entryUnit แต่ไม่มี baseQty นับ incoming = 0** | `purchasing.ts:101` | L |
| D13 | **การนับไม่ blind** (แสดงยอดระบบให้คนนับเห็น) | `MonthlyCountSheet.tsx:298` | M (ด้าน control) |
| D14 | **duplicate bill เป็นแค่คำเตือน** ถ้าเช็คล้มก็ผ่าน | `Receive.tsx:197-207` | M |

## 6. Permission / Security Risks

| # | ความเสี่ยง | หลักฐาน | I |
|---|---|---|---|
| S1 | **พนักงานเขียน `stockLevels` ตรงได้ทุกค่า** (เงื่อนไขแค่ `updatedBy == uid`) | `firestore.rules:255-269` | **C** |
| S2 | **ข้าม "โอนข้ามสาขาเฉพาะหัวหน้า" ได้** ด้วยการใส่ `transferId` อะไรก็ได้ (ไม่เช็คว่ามีจริง) | `rules:982-983` | H |
| S3 | **แก้ `items` ของ PR ที่ approved แล้วได้** และใครก็ได้ย้ายสถานะ approved → poCreated | `rules:1126-1160` | H |
| S4 | **พนักงานสร้าง PO เป็น `ordered` ตรงๆ ได้** และ approve draft PO ได้ (rules เช็คแค่ `approvedBy == caller`) | `rules:947-949`, `:1056-1058` | H |
| S5 | **rules ให้ทุกคน edit movement** (qty/date/location) แม้ UI ซ่อนไว้ให้แอดมิน | `rules:1266-1303`, `Movements.tsx:323` | H |
| S6 | **พนักงานแก้ `unitConversions` ได้โดยไม่มี audit** ซึ่งเปลี่ยนการแปลงหน่วยของทุก PO/รับของในอนาคต | `rules:1652-1654` | H |
| S7 | **`/api/ocr-bill` และ `/api/po-image` เช็คแค่ token ถูกต้อง** ไม่เช็ค active/revoked; บัญชีที่ถูกถอนสิทธิ์ยังใช้โควตา Gemini/KV ได้ | `_poImage.ts:56-68` | M |
| S8 | **rules ไม่บังคับ enum เหตุผลการปรับ** (`text(reason,60)`) เขียนนอก UI หลุดจากรายงาน loss ได้ | `rules:235` | M |
| S9 | **SheetJS 0.18.5 (มี advisory prototype-pollution/ReDoS) parse ไฟล์ผู้ใช้** และ `SECURITY-NOTES.md` ไม่อัปเดตเรื่องนี้ | `sheetLines.ts:49` ฯลฯ | M |
| S10 | **`PO_IMAGE_DEMO_KEY` เทียบแบบไม่ constant-time; ไฟล์ประกาศไม่มีวันหมดอายุ** | `_poImage.ts:28-38,70-75` | L |
| S11 | **ผู้ใช้ใหม่ไม่มีการยืนยันอีเมล** (สมัครเองได้ staff inactive) | `rules:1323-1328` | L (ดีแล้ว) |

## 7. Performance

- **P1 bundle:** ไม่มี lazy route เลย (`App.tsx:15-45`) `main-*.js` ขนาด **2.9 MB** รวม xlsx + jsPDF + ฟอนต์ Sarabun 120 KB เพราะ static import ใน `Products.tsx:20`, `StockCardPage.tsx:19`, `MonthlyCountSheet.tsx:15`, `QuestionsCard.tsx:5`, `orderSheet/sheetLines/stockSheet`
- **P2 คำนวณซ้ำ:** DataContext value สร้างใหม่ทุกครั้งที่ listener ใดเปลี่ยน (`DataContext.tsx:187-204`) ทำให้ insights/shortageRisks/usageIndex/buildFeed คำนวณใหม่ทุกครั้งที่มีแจ้งเตือนเข้า และคำนวณซ้ำต่อ component (Dashboard ×2, PhoneHome ×2) แต่ละ `useSupplierIntel` ยังมี interval ของตัวเอง
- **P3 rangeCache ไม่ merge ช่วงที่ซ้อนกัน** Dashboard ยิง orderCache อย่างน้อย 2 ครั้ง (`rangeCache.ts:279-286`)
- **P4 "โหลดประวัติทั้งหมด"** เปลี่ยน listener movements เป็นทั้ง collection ตลอด session (`LedgerWindowNotice.tsx:31`)
- **P5 Import page อ่าน movements ทั้ง collection ทุกครั้งที่เลือกไฟล์** (`Import.tsx:96,182`)
- **P6 N+1:** `getOne(products)` ใน loop รับของ (`purchaseOrders.ts:614`), transfers อ่าน locations ใหม่ทุก action
- **P7 readMeter ไม่นับ** `getOne/getBy/tx get` (`firestore.ts:106,117,149`) ตัวเลขที่เห็นจึงต่ำกว่าจริง
- **P8 ยังไม่ได้ลด:** products (~323) + stockLevels ซึ่งเป็นต้นทุนหลักต่อการเปิดแอป

## 8. Mobile

- **ดีแล้ว:** 3 shell (tab bar / rail / side), QtySheet, PhoneHome, agenda ปฏิทิน, Modal sheet
- **ปัญหา:**
  - ตารางกว้างที่ไม่มีโหมดการ์ด (ข้อ 3.4) + TransferEditor/DetailView
  - list ยาวไม่แบ่งหน้า
  - toast/banner ทับ tab bar
  - breakpoint ปฏิทิน 640 ไม่ตรงกับ 767
  - **`user-scalable=no` ปิด pinch-zoom** (`index.html:8`, ผิด WCAG)
  - ปุ่มไอคอนบางตัวเล็ก (`Settings.tsx:539` 24px)
- **บันทึกสต๊อกต้องออนไลน์** (ทุก write เป็น `runTransaction`) และ**ไม่มีตัวบอกว่าออฟไลน์**

## 9. Integration Risks

| ระบบ | ความเสี่ยง |
|---|---|
| LINE LIFF | LIFF ID เดียว endpoint เดียว (demo/prod ชนกัน); ส่งในนามบุคคล ไม่มี delivery receipt; @All จริงทำไม่ได้จนกว่ามี OA |
| Gemini/Workers AI | ขึ้นกับ `GEMINI_API_KEY`; model ถูกเลิกใช้ได้ (มี discovery แล้ว); ไม่มี log ฝั่ง function; ผล OCR ต้องให้คนยืนยันเสมอ (ทำแล้ว) |
| Service account | เขียนข้าม rules; ต้องคง allowlist ใน `serverStore.ts`; `SUPPLIER_DEV_FIXTURE` ห้ามตั้งบน prod |
| Cron Worker | **ยังไม่ deploy** งานเตือนจึงพึ่งเบราว์เซอร์หัวหน้าที่เปิดอยู่ (ล้มเงียบ) |
| KV po-image | TTL 7 วันสำหรับ PO; ประกาศเก็บไม่มีวันหมด |
| Firestore Spark | 50k reads/วัน เคยเต็ม 4 ครั้ง; ไม่มี recovery บนแผนฟรี มีแค่ JSON backup |
| POS | นำเข้าไฟล์ด้วยมือ ไม่มี API |

## 10. Missing Auditability

ไม่มีประวัติเลยสำหรับ:
- แก้สินค้า (ยกเว้นต้นทุน), `unitConversions`, ผู้ขาย, สถานที่, ผู้ใช้ (role/active/siteIds), settings/thresholds/schedules, entry units, company profile, min overrides
- **ลบแบบ hard ทั้งหมด:** สินค้า, สถานที่, ผู้ขาย, draft PO, งาน, ข้อความ
- renumber PO (เลขเก่าหาย), recompute, repair dates, restore backup

**อื่นๆ:**
- void movement ไม่บังคับเหตุผล
- ActivityLog ไม่รวม transfers และ master data
- PR/transfer history ตัดที่ 500 และ PO revisions ตัดที่ 50 (ของเก่าหาย)

## 11. Missing Exception Handling

- **Listener error ค้าง loading ตลอดไป** ไม่ retry ไม่บอกผู้ใช้ (`useLive.ts:36-44`)
- **กลืน error เงียบ:** `useSupplierIntel.ts:55` อ่านล้มแล้วแสดง "ไม่มีความเสี่ยง" (อันตราย), Movements history, useAutomation, useSupplierRefresh, useTodayEventCount
- **ไม่มี React error boundary** หน้าพังเป็นจอขาว
- **ไม่มีรองรับออฟไลน์สำหรับ write** (ไม่มีคิว ไม่มีตัวบอก)
- **ไม่มี draft ใน** TransferEditor, RequestEditor, ProductEditor, ฟอร์มผู้ขาย, PurchaseImport
- **ไม่มีตรวจการโอนค้างในทาง** ไม่มีเตือน PO ที่รับบางส่วนแล้วค้างนาน
- **ไม่มี idempotency key ฝั่ง server สำหรับ movement** พึ่ง busy flag อย่างเดียว

## 12. Feature Gaps (ทั้งที่มีบางส่วนและที่ไม่มี)

| Gap | สภาพตอนนี้ |
|---|---|
| Reserved/Available | ไม่มี |
| Hold/Damaged/Quarantine | ไม่มี (ตัดทิ้งทันที) |
| Rejected qty ตอนรับ | ไม่มี |
| Reason codes สำหรับรับขาด/เกิน | ไม่มี (free text) |
| Period close/lock | ไม่มี |
| Blind count | ไม่มี |
| Variance approval threshold | มีแค่แจ้งเตือน adjust ใหญ่ |
| Exception inbox รวม | ไม่มี (แจ้งเตือนกระจาย) |
| เตือนโอนค้างในทาง | ไม่มี |
| PR approval threshold ตามมูลค่า | ไม่มี |
| Error reporting | ไม่มี |
| Offline write | ไม่มี |
| Unified import hub | มีบางส่วน (เมนูด่วน) |
| Audit ของ master data | ไม่มี |
| Supplier scorecard ใช้ข้อมูลยืนยัน | มีบางส่วน |
| Expiry/lot | ไม่มี (ถามเจ้าของก่อนว่าต้องการไหม) |

## 13. Remove / Merge / Simplify

- **MERGE:**
  - Batch Excel (`/purchase`) เข้า PR import ทางเดียว
  - Import 9 ทางเป็น **Import Hub** เดียว (ใช้ `LineImportModal` + target)
  - `/transfers/today` เป็นแท็บใน `/transfers`
- **SIMPLIFY:**
  - เอาโหมด "โอนตรง" ออกจาก Issue ของพนักงาน (ให้ปุ่มไป `/transfers/new` แทน)
  - รวม Settings maintenance 5 ตัวเป็นหน้า "เครื่องมือซ่อม" ที่ทุกตัวมี confirm + reason + audit
- **REMOVE (หลังถามเจ้าของ):**
  - "ล้างและนำเข้าใหม่" แคตตาล็อก (ลบยอดที่นับไว้ ไม่มี audit)
  - hard delete สินค้า/สถานที่ → ให้ซ่อนแทน (ตรงกับกติกาเดิม "ห้ามลบ ให้ซ่อนแทน")
- **แตกไฟล์:** `Orders.tsx` (1,399), `Settings.tsx` (1,307), `TransferDetailView.tsx` (810)
- **ลบขยะ:** `firestore-debug*.log` 4 ไฟล์ที่ root

## 14. AI / Automation Opportunities (เปิดได้หลังข้อมูลน่าเชื่อถือ คือหลัง Phase A–B)

| ความสามารถ | ขึ้นกับ |
|---|---|
| Reorder draft PR อัตโนมัติ (มี DailySuggestions อยู่แล้ว) | D2, D11 |
| OCR บิล → จับคู่ PO + เติม invoice/วันที่ + เทียบราคา | D1, D8 |
| Anomaly: adjust/waste ผิดปกติต่อสาขา, ราคาผิดปกติจากบิล, usage spike | audit + reason enum |
| Supplier risk score (on-time, fill, เลื่อนวัน) → แนะนำผู้ขายสำรอง | ข้อมูลยืนยันผู้ขาย |
| Transfer suggestion สาขาเกิน → สาขาขาด (มีแล้ว ใช้ reserved) | D11 |
| Count scheduling ตามความเสี่ยง (cycle count ABC) | blind count, period lock |
| สรุปภาษาไทยรายวันสำหรับเจ้าของ (Worker) | deploy Worker |

**ไม่ทำ:** auto-approve, auto-send PO, auto-adjust stock ห้ามทำจนกว่าจะถึง Phase F และต้องให้เจ้าของเปิดเอง

## 15. Architecture Debt

- **ไม่มี server-side command layer** ทุก business write อยู่ฝั่ง client + rules (atomic ข้าม aggregate ทำได้แค่ใน tx ฝั่ง client) แนวทางที่เสนอคือย้าย write ที่สำคัญ (receivePO, convertPR) ไปเป็น **tx เดียวฝั่ง client** ก่อน (ไม่เพิ่ม cost) และไม่ย้ายไป Functions จนกว่าจำเป็น
- **rules expression budget** เหลือราว 150 จาก 1,000 การเพิ่ม validation ทำได้ยาก
- **DataContext ก้อนเดียว** ทำให้ re-render ทั้งแอป
- **rangeCache ไม่ invalidate ข้ามอุปกรณ์**
- **typecheck ของ `src/ui` (อ้างในบันทึกของ HR app)**, ไม่มี UI/e2e tests, service ที่ไม่มีเทส: `monthlyCounts.ts`, `locations.ts`, `poImages.ts`, hooks ของ data, `api/ocr-bill`
- **ไม่มี telemetry/logging ฝั่ง functions**

## 15A. ADR-001: Trusted Command Boundary สำหรับ Critical Stock Commands

**ปัญหา:** ยอดคงเหลือทุกตัวเลขเขียนจาก client แล้วพึ่ง rules ตรวจ ทุกวันนี้มีช่องโหว่สามแบบ:
- rules กว้างเกินไป (S1, S5)
- budget เหลือราว 150 expressions จึงตรวจเพิ่มได้ไม่มาก
- rules ตรวจได้แค่รูปร่างเอกสาร **พิสูจน์ไม่ได้ว่า `stockLevels` ใหม่ = เดิม + movement ที่เขียนคู่กัน**

ผลคือ client ที่ถูกดัดแปลงตั้งยอดเองได้เสมอ ตราบที่ client ยังเป็นผู้เขียน `stockLevels`

**ตัดสิน:**
- **Phase A (client transaction) = แก้ atomicity เท่านั้น ไม่นับว่าปิดเรื่อง security** รายงานและ exit gate ต้องเขียนไว้ชัดๆ อย่างนี้
- **Phase A-sec:** ย้าย critical commands ไปเป็น Cloudflare Pages Functions ทีละตัว ใช้ `functions/_lib/serverStore.ts` (service account ที่เจ้าของสร้างไว้แล้วสำหรับ supplier confirmation) แต่ละคำสั่งทำงานแบบนี้:
  - ตรวจ Firebase ID token + `users/{uid}` active/role (รูปแบบเดียวกับ `_lib/supplierPo.ts:75-81`)
  - โหลดเอกสารที่เกี่ยวข้องฝั่ง server แล้ว**คำนวณยอดเองจาก movement** (ใช้ pure modules ใน `src/lib` ร่วมกันแบบที่ `supplierConfirmation.ts` ทำ)
  - commit ด้วย precondition `updateTime` และ operationId กันซ้ำ
  - allowlist collection/field ต่อคำสั่ง
- **ลำดับการย้าย** (ตามความเสี่ยง):
  1. `receivePO`
  2. `adjust` และ `postCount`
  3. `approveTransfer` / `receiveTransfer` / `resolveDiscrepancy`
  4. `issue` / `consume` / POS
  5. `convertPR` (แตะ PO/PR ไม่แตะยอด จึงอยู่ท้าย)
- **เมื่อคำสั่งครบทุกตัวที่เขียน `stockLevels`:**
  - rules ปิด client write ของ `stockLevels` และ create ของ `stockMovements` ทั้งหมด (`allow write: if false`)
  - ทำให้ rules **สั้นลง** และคืน budget ได้ด้วย
  - edit/void ของแอดมินก็ย้ายไป command เช่นกัน
- **ข้อแลก:**
  - ทุก write ต้องออนไลน์ ซึ่งเป็นสภาพเดิมอยู่แล้วเพราะเป็น transaction
  - Functions ฟรี 100k req/วัน เกินการใช้จริงหลายเท่า
  - read/write Firestore ไม่เพิ่ม (server อ่านแทน client)
  - เพิ่ม latency ราว 200–400ms
  - service account ข้าม rules จึง**ต้องมีเทสของ handler ครบแทน rules**
- **Rollback:** ต่อคำสั่ง ใช้ flag `stockCommands.<name>` ใน settings เพื่อกลับไปทาง client ได้**เฉพาะก่อน**ปิด rules เมื่อปิด rules แล้วจะไม่มีทางถอยไป client (กันการเปิดช่องโหว่กลับ)
- **ต้องพิสูจน์ด้วย emulator test:**
  - client ที่ดัดแปลงแล้วเขียน `stockLevels` ตรง / เขียน movement ปลอม / ใส่ transferId ปลอม / แก้ PR หลังอนุมัติ ต้อง **DENY** ทุกกรณี
  - workflow ปกติผ่าน command ต้อง **ALLOW**

## 16–19. Ranked Backlog (Effort / Impact / Dependency)

| ID | งาน | E | I | ขึ้นกับ |
|---|---|---|---|---|
| A0 | **Integrity Auditor** (read-only, ดูข้อ 22) รันก่อนและหลังทุกเฟส | M | C | — |
| A1 | **รับของ PO แบบ idempotent ใน tx เดียว** (รายละเอียดด้านล่าง) | M | C | A0 |
| A2 | **Incoming คงค้างตามหน่วยฐาน** (สูตรด้านล่าง) + legacy fallback + backfill แบบ dry-run | M | C | A0 |
| A3 | **ADR-001** ย้าย critical commands ไป Functions ทีละตัว แล้วปิด client write ของ `stockLevels`/`stockMovements` (ข้อ 15A) | XL | C | A1, A10 |
| A4 | rules: `transferId` ต้องมีเอกสาร transfer จริงที่ approved | S | H | วัด budget |
| A5 | rules: ล็อก `items` ของ PR หลัง approved; poCreated ต้องมาจากผู้แปลง | S | H | — |
| A6 | **Idempotent PR→PO conversion** (รายละเอียดด้านล่าง) + เครื่องมือกู้ PR ที่ค้างครึ่งทางแยกต่างหาก | M | H | — |
| A7 | amend/cancel/closeRemainder เป็น tx | S | H | A1 |
| A8 | แก้/void movement ที่มี poId → sync PO หรือห้าม (ให้ใช้ adjust) | M | H | A1 |
| A9 | rules: edit movement เฉพาะแอดมิน; void ต้องมีเหตุผล | S | H | — |
| A10 | count post: คำนวณ diff ใหม่ใน tx จากยอด ณ ตอนนั้น | M | H | — |
| B1 | Period lock (เดือนที่ post แล้วห้าม backdate/แก้ เว้นแอดมิน + เหตุผล) | M | H | A10 |
| B2 | Audit log กลาง (`auditLog` ต่อแบรนด์) สำหรับ master data, users, settings, delete, maintenance **ต้องขอเจ้าของเพราะเป็น collection ใหม่** | M | H | — |
| B3 | ลบสินค้า/สถานที่ → ซ่อน; ห้าม hard delete ที่มี ledger | S | M | — |
| B4 | PO สร้างตรงโดยพนักงานเป็น draft รออนุมัติ (หรือให้เจ้าของตัดสิน) | S | H | ถามเจ้าของ |
| B5 | Rejected/damaged qty + reason enum ตอนรับ + เพดานรับเกิน | M | M | A1 |
| B6 | OCR/po-image เช็ค active/revoked | S | M | — |
| B7 | rules บังคับ enum เหตุผล adjust | S | M | วัด budget |
| C1 | `useLive` error/retry + error boundary + ไม่กลืน error ใน intel | S | H | — |
| C2 | เตือนโอนค้างในทาง + PO รับบางส่วนค้าง | S | M | A2 |
| C3 | Exception Inbox (รวมงานต้องตัดสิน: PR, date approval, discrepancy, variance, ค้าง) | L | H | C1, C2 |
| C4 | ตัวบอกออฟไลน์ + draft ใน editor ที่ขาด | S | M | — |
| D1' | Lazy routes + แยก xlsx/jspdf/ฟอนต์ (เป้าหมาย main < 900 KB) | M | M | — |
| D2' | DataContext แยก context + intel/feed คำนวณครั้งเดียว (provider) | M | M | — |
| D3' | rangeCache merge ช่วงที่ซ้อน + readMeter นับ getOne | S | M | — |
| D4' | Import Hub, รวม Batch เข้า PR, ตัดโหมดโอนใน Issue | L | M | ถามเจ้าของ |
| D5' | Prefill จำนวนรับ, การ์ดมือถือสำหรับ RequestReview/Adjust/Perf, toast ไม่ทับ tab bar, เปิด pinch-zoom | M | M | — |
| D6' | แบ่งหน้าให้ list ยาว, DataTable ไม่ render ซ้ำ | S | M | — |
| C5 | **Notification:** severity ครบ, popup + เสียง, dedupe, burst aggregation (มีแล้ว) + **critical ค้างจนกดรับทราบ** + deep action (ปุ่ม อนุมัติ/ดู/รับของ ในการ์ด) + toast error ค้าง + `aria-live` + ไม่ทับ tab bar (ดูคำถาม 6) | M | H | C1 |
| E1 | **Reserved/Available จาก outbound commitment จริงเท่านั้น:** transfer ที่ approved แต่ยังไม่ dispatch (ถ้ามี) + allocation ที่ล็อกแล้วในอนาคต **ไม่นับ PR approved** ส่วน PR approved / PO draft ไปอยู่ฝั่ง **Planned Inbound** แยกต่างหาก (ใช้วางแผน ไม่หักยอด) | M | M | A2 |
| T1 | **Playwright E2E + concurrency harness** บน Firestore emulator (ดูข้อ Verification) | L | C | — |
| E2 | Blind count option + variance threshold ต้องหัวหน้าอนุมัติ | M | M | A10 |
| E3 | Deploy cron Worker (เจ้าของต้องใส่ key) | S | H | owner |
| E4 | Error reporting เบาๆ (เขียน `meta/clientErrors` แบบ sampled หรือ Workers log) | S | M | ถามเจ้าของ |
| F1 | AI: reorder draft, OCR → PO match, anomaly, supplier risk (ข้อ 14) | L–XL | H | A–C ทั้งหมด |

### รายละเอียด A1: Receiving idempotency

- **`operationId`:**
  - สร้างครั้งเดียวตอนเปิดหน้ารีวิวรับของ และเก็บใน `useDraft` ด้วย ทำให้ retry หลังเน็ตหลุดหรือรีเฟรชใช้ id เดิม
  - เปลี่ยนเป็นค่าใหม่หลัง commit สำเร็จ หรือเมื่อเริ่มบิลใหม่
- **ไม่เพิ่ม collection:**
  - `receiptId = rc_<poId>_<operationId>`
  - movement doc id = `receiptId` (deterministic)
  - `PurchaseOrder.receipts[]` เก็บ `receiptId`
- **ภายใน transaction ใดๆ:**
  1. `tx.get(movement/receiptId)` ถ้ามีอยู่แล้ว → **replay** คืนผลเดิม ไม่เขียนอะไร
  2. `tx.get(PO)` แล้วตรวจ `status === 'ordered'` และคำนวณยอดค้างจากสภาพ**ใน tx**
  3. `tx.get(levels)` ที่เกี่ยว
  4. เขียน movement + levels + PO (`receipts` + `receivedQty` + `status`) พร้อมกัน
- **สองเครื่องรับพร้อมกัน:**
  - Firestore retry tx ที่ชนกัน รอบที่สองจะเห็น PO ที่อัปเดตแล้ว
  - ถ้ายอดค้างเหลือ 0 → ปฏิเสธพร้อมข้อความ "รับไปแล้วโดย X"
- **rules:**
  - movement ที่มี `poId` ต้องมี id = `rc_<poId>_*`
  - PO update `receipts.size == old + 1` เดิมยังคงอยู่
- **ข้อจำกัด tx ของ Firestore:** อ่านก่อนเขียน, ไม่เกิน 500 เอกสาร (PO ใหญ่สุดราว 60 บรรทัด จึงพอ)

### รายละเอียด A2: สูตร Incoming

**สูตรต่อบรรทัด** (`receivedQty` เก็บเป็นหน่วยที่สั่ง ตาม `types.ts:401-407`):

```
factor        = !entryUnit ? 1
              : baseQty && orderedQty>0 ? baseQty/orderedQty          // อัตรา ณ ตอนสั่ง
              : legacyFactor(product, entryUnit)  // ประเมิน, ติดธง estimated
remainingBase = max(0, (orderedQty − (receivedQty ?? 0)) × factor)
```

**นับเฉพาะ PO ที่ `status === 'ordered'`:**
- PO ที่ `closeOrderRemainder` แล้วจะเป็น `received` ส่วนที่ยกเลิกเป็น `cancelled` จึงหลุดออกตามสถานะ = ยอดที่ปิด/ยกเลิกถูกหักแล้ว
- ถ้าภายหลังมีการปิดยอดรายบรรทัด ให้เพิ่ม `closedQty` ในสูตรเป็น `− closedQty`
- **รับเกิน** clamp ที่ 0 ต่อบรรทัด ไม่ไปหักบรรทัดอื่น

**Legacy (มี `entryUnit` แต่ไม่มี `baseQty`):**
- ใช้อัตราปัจจุบันของสินค้าแบบ**ติดธง estimated** (UI แสดง "ประมาณ")
- ถ้าไม่มีอัตรา → ไม่นับ และ Auditor รายงานเป็น exception (แทนการนับ 0 แบบเงียบ)

**Backfill:**
- script `scripts/backfill-po-baseqty` ทำ **dry-run บน backup JSON ก่อน**
- เขียนจริงต้องให้เจ้าของสั่ง
- ตั้ง `baseQty` ของ PO ที่ยัง `ordered` เท่านั้น

**ใช้ helper เดียว** `remainingBaseQty(line, product)` ใน `inventoryRules/purchasing.ts` ทั้งที่ `incomingFor`, การ์ด DeliveryRisk, Calendar และ Receive (ยอดค้าง) เพื่อให้ตัวเลขตรงกันทุกจุด

### รายละเอียด A6: Idempotent PR→PO conversion

- **PO id แบบ deterministic:** `po_<prId>_<supplierId>` ทำให้กดซ้ำหรือเปิดสองแท็บได้เอกสารเดิมเสมอ
- **ทุกอย่างใน transaction เดียว:**
  1. `tx.get(PR)` ต้อง `approved`
  2. `tx.get` PO ทุกใบตาม id แล้วสร้างเฉพาะใบที่ยังไม่มี
  3. นับเลข PO ต่อผู้ขายใน tx (อ่าน counter ใน tx แทน query นอก tx ที่ `purchaseOrders.ts:228`)
  4. PR → `poCreated` + `convertedAt` + `conversionRunId` + `orderIds`
- ถ้า PR เป็น `poCreated` แล้ว → คืน `orderIds` เดิม (replay)
- tx เดียวจึง**ไม่มี partial state ใหม่**
- **PR เก่าที่ค้างครึ่งทาง:**
  - Auditor หา PR `approved` ที่มี PO `requestId` อยู่แล้ว
  - เครื่องมือ "ซ่อม PR ค้าง" ของแอดมินแสดงรายการให้เลือกทีละใบ: ผูก PO ที่มีอยู่แล้วเข้ากับ PR หรือยกเลิก PO กำพร้า **ไม่ทำอัตโนมัติ**
- **rules:**
  - `approved → poCreated` ต้องมาพร้อม `orderIds` และ `convertedBy == caller`
  - ล็อก `items` หลัง `approved` (A5)

**Dependency graph:**

```
T1 (harness) ─→ gate ของทุกเฟส
A0 (auditor) ─→ baseline ─→ A1, A2, A6 ─→ re-audit
A1 ─┬→ A7, A8
    ├→ B5 ─→ F1(OCR→PO)
    └→ A3 (receivePO command แรก)
A10 ─→ B1 ─→ E2
A10 ─→ A3 (postCount command)
A4/A5/A9/B7 (rules) ─→ วัด budget, deploy รอบเดียว
A3 ครบทุก command ─→ rules ปิด client stock write
A2 ─→ C2 ─→ C3 ; A2 ─→ E1 ─→ F1
C1 ─→ C5, C3
A0 + B2 ─→ F1(anomaly)
D* อิสระ (ทำคู่ขนานได้)
```

## 20. Phases

- **Phase 0: Evidence base** (T1, A0) ได้ harness + ผล audit baseline ของข้อมูลจริง (อ่านอย่างเดียว) ก่อนแตะ logic ใดๆ
- **Phase A: Ledger atomicity** (A1, A2, A6, A7, A8, A10) client transaction **= atomicity ไม่ใช่ security**
- **Phase A-rules:** (A4, A5, A9, B7) **deploy rules รอบเดียว** ต้องให้เจ้าของยืนยัน + reauth และวัด budget ก่อน
- **Phase A-sec:** (A3 / ADR-001) ย้ายทีละ command แล้วปิด client stock write เป็นขั้นสุดท้าย
- **Phase B: Control & audit** (B1–B6) โดย B2 ต้องอนุมัติ collection ใหม่
- **Phase C: Exceptions & observability** (C1–C5, E3, E4)
- **Phase D: Efficiency & UX** (D1'–D6') ทำคู่ขนานกับ A ได้เพราะไม่แตะข้อมูล
- **Phase E: Inventory model** (E1, E2)
- **Phase F: Intelligence → automation** (F1) แบบแนะนำก่อน, auto ต้องให้เจ้าของเปิดเอง

**แต่ละเฟสทำแบบนี้:**
- branch ของตัวเองจาก `origin/main`
- เทส `npm test`, `test:rules`, `test:e2e`, lint, i18n, build
- เดินบน `npm run demo`
- ผ่าน exit criteria ของเฟส (ข้อ 21)
- รอเจ้าของสั่ง merge ทุกครั้ง

## 21. Phase Exit Criteria (freeze evidence)

ทุกเฟสต้องมี `docs/evidence/phase-<X>.md` เก็บ:
- commit SHA
- ผลคำสั่งเทสทั้งหมด (จำนวน pass/fail)
- ผล Auditor ก่อน/หลัง
- รายการ scenario E2E พร้อมผล
- ภาพหน้าจอสำคัญ

**PASS ต้องครบทุกข้อ ขาดข้อเดียว = ไม่ merge**

| เฟส | เกณฑ์ (ทุกข้อวัดด้วยเทสอัตโนมัติ เว้นแต่ระบุ) |
|---|---|
| **0** | Playwright รันบน emulator ได้ 2 client พร้อมกัน; Auditor รันบน backup JSON ของ production (offline) ได้รายงาน baseline ครบ 6 หมวด; **ไม่มี write ใดๆ** |
| **A** | duplicate receipt = **0** (2 client พร้อมกัน, retry operationId เดิม ×5, network fail กลาง tx) · incoming ของ PO รับบางส่วน/รับเกิน/legacy/หลายหน่วย ถูก **100%** ของ test cases · PR double conversion = **0** (double click, 2 แท็บ) · count concurrency invariant pass (movement แทรกระหว่าง review→confirm ให้ยอดสุดท้าย = ยอดที่นับ) · edit/void movement ผูก PO แล้ว PO ตรง ledger · regression เดิมผ่านทั้งหมด (`npm test` ≥ จำนวนเดิม, `test:rules`) · Auditor บนข้อมูล demo = 0 mismatch · backfill/migration **dry-run pass** บน backup จริง (รายงานจำนวนที่จะเปลี่ยน และไม่มีบรรทัดที่หาอัตราไม่ได้แบบเงียบ) |
| **A-rules** | staff direct stock write = **DENY** · fake transferId = **DENY** · approved PR item modification = **DENY** · staff movement edit = **DENY** · void ไม่มีเหตุผล = **DENY** · reason นอก enum = **DENY** · legitimate workflows (รับ, เบิก, ปรับ, โอนทั้งวงจร, PR→PO, นับ→post) = **ALLOW** ทุกบทบาทที่ควรได้ · budget test เอกสารกว้างสุดผ่านโดยมี headroom ≥ 50 expressions |
| **A-sec** (ต่อ command) | handler tests: auth/role/inactive/revoked, คำนวณยอดฝั่ง server, replay, precondition conflict · E2E เดิมผ่านผ่าน command · ยอดเท่ากับทาง client ทุก scenario (golden comparison) · ขั้นสุดท้าย: client write `stockLevels`/`stockMovements` = **DENY** ทุกบทบาท รวมแอดมิน |
| **B** | ทุก action ในตารางข้อ 10 มีแถว audit (เทสต่อ action) · backdate เข้าเดือนที่ปิดแล้ว = ปฏิเสธ (เว้นแอดมิน + เหตุผล + audit) · ลบสินค้า/สถานที่ที่มี ledger = ปฏิเสธ |
| **C** | listener ที่ถูก deny/ล้ม แสดงข้อความ + retry (E2E) · intel อ่านล้ม ≠ "ไม่มีความเสี่ยง" · critical ค้างจนกดรับทราบ (หรือตามที่เจ้าของตัดสินในคำถาม 6) · toast ไม่ทับ tab bar ที่ 375px (screenshot) · axe: 0 serious บน 5 หน้าหลัก |
| **D** | main chunk < 900 KB · Lighthouse mobile TTI ดีขึ้นอย่างน้อย 30% · readMeter นับ getOne · reads ต่อการเปิดแอปไม่เพิ่ม (quota-budget test) |
| **F** | คำแนะนำ AI ทุกตัวแสดงหลักฐาน/ที่มา · Auditor ล่าสุด 0 critical mismatch เป็นเวลา 14 วันก่อนเปิดฟีเจอร์ · ไม่มี auto-action ที่ไม่ได้เปิดโดยเจ้าของ |

## 22. Integrity / Reconciliation Auditor (A0)

**ความสามารถ:**
- read-only ล้วน **ห้าม auto repair**
- เจอความไม่ตรงกันแล้วสร้าง exception ให้คนตัดสิน
- ใช้ pure module `src/lib/integrityAudit.ts` ตัวเดียวกันทั้งแอป, script, Worker

**ตรวจ 6 หมวด:**

| # | ตรวจ | วิธี |
|---|---|---|
| 1 | `stockLevels` == ledger-derived balance | ต่อยอดจาก `balancesFromLedger` / `findLevelDrift` (`stock.ts:1325,1366`) |
| 2 | PO `receivedQty` == ผลรวม receipt movements ที่ไม่ void (ตาม `poId`) และ `receipts[]` ตรงกับ movement | join movement ↔ PO |
| 3 | ยอด Transit == Σ dispatch − Σ receive − Σ resolve ต่อ transfer และไม่มี transfer `completed` ที่ยังค้าง Transit | `transfers.ts` line `inTransitQty` |
| 4 | ไม่มี orphan: movement ที่ชี้สินค้า/สถานที่/PO/transfer ที่ไม่มีแล้ว; PO ที่ `requestId` ชี้ PR ที่ยัง `approved` | join |
| 5 | ไม่มียอดติดลบ, ไม่มี unit ที่ไม่มีอัตรา, ไม่มี legacy line ที่หาอัตราไม่ได้, ไม่มี key `#Unit` ค้าง | scan |
| 6 | ไม่มี receipt ซ้ำ: movement ที่ poId + invoiceNo + qty เดียวกันหลายแถว (ก่อน A1) / receiptId ซ้ำ (หลัง A1) | group by |

**สามทางรัน (ไม่เพิ่ม read แบบไม่จำเป็น):**
1. **Offline บน backup JSON** (`scripts/integrity-audit.mjs <backup.json>`) ใช้ 0 reads เป็นทางหลักของ Phase 0
2. **ปุ่มแอดมิน** ใน Settings › เครื่องมือซ่อม (อ่านทั้ง collection ครั้งเดียว แสดงจำนวน reads ก่อนกด)
3. **Worker รายสัปดาห์** (หลัง E3) เขียน exception เป็น notification `integrityMismatch` ถึงแอดมินเท่านั้น

**ผลลัพธ์:** ตาราง mismatch ต่อหมวดพร้อมลิงก์ไปเอกสาร ส่วนการแก้ใช้เครื่องมือที่มีอยู่ (adjust พร้อมเหตุผล, recompute ที่มี confirm + audit) โดยคนกดเองทีละรายการ

---

## TOP 10 (เรียงตามความเสี่ยงต่อความถูกต้องของข้อมูล)

| # | งาน | เหตุผล |
|---|---|---|
| 1 | **T1 + A0** Playwright/emulator harness + Integrity Auditor (baseline จาก backup) | ไม่มีหลักฐานก็ไม่รู้ว่าข้อมูลจริงเสียไปแล้วแค่ไหน และไม่รู้ว่าแก้แล้วพร้อมหรือยัง |
| 2 | **A1** รับของ idempotent (operationId + receiptId deterministic) ใน tx เดียว | stock เข้าซ้ำได้จริงเมื่อเน็ตหลุดหรือ 2 เครื่อง |
| 3 | **A2** Incoming คงค้างตามหน่วยฐาน + legacy fallback | คำแนะนำสั่งซื้อและความเสี่ยงของขาดผิดทุกครั้งที่มี PO รับบางส่วน |
| 4 | **A6 + A5** PR→PO idempotent (PO id deterministic) + ล็อก PR หลังอนุมัติ | PO ซ้ำ/กำพร้า และของที่อนุมัติถูกแก้ทีหลังได้ |
| 5 | **A8 + A9** movement ที่ผูก PO ต้อง sync, edit เฉพาะแอดมิน, void ต้องมีเหตุผล | ledger กับ PO ไม่ตรงกัน, rules กว้างกว่า UI |
| 6 | **A10 + B1** นับเดือนคำนวณ diff ใน tx + period lock | ยอดที่ปิดเดือนแล้วถูกเปลี่ยนเงียบๆ ได้ |
| 7 | **A4** transferId ต้องเป็นของจริง (rules รอบเดียวกับ A5/A9/B7) | ข้ามการควบคุมโอนข้ามสาขา |
| 8 | **A3 / ADR-001** trusted command boundary เริ่มที่ receivePO แล้วปิด client stock write | rules พิสูจน์ความถูกต้องของยอดไม่ได้ ตราบที่ client ยังเขียนยอดเอง |
| 9 | **C1 + C5** listener error/retry, intel ไม่กลืน error, notification critical ค้าง + deep action | หน้าค้างหรือแสดง "ไม่มีความเสี่ยง" ทั้งที่อ่านไม่สำเร็จ; เรื่องวิกฤตหายไปใน 4 วินาที |
| 10 | **B2 + B3** audit log กลาง + ซ่อนแทนลบ | master data/ผู้ใช้/การลบไม่มีร่องรอย (ขัดกติกาเจ้าของ) |

(D1'/D2' ประสิทธิภาพ ทำคู่ขนานได้ แต่ไม่ติด Top 10 เพราะไม่กระทบความถูกต้อง)

## คำถามที่ต้องให้เจ้าของตัดสินก่อนเริ่ม (ไม่บล็อกการอ่านรายงาน)

1. พนักงานสร้าง PO ตรง (`ordered`) ได้ต่อไป หรือบังคับผ่าน PR/อนุมัติ (B4)
2. อนุญาต collection ใหม่ `auditLog` ไหม (B2)
3. ตัด "ล้างและนำเข้าใหม่" แคตตาล็อก และเปลี่ยน hard delete เป็นซ่อน
4. รวม Batch Excel เข้า PR และตัดโหมดโอนใน Issue ของพนักงาน
5. ต้องการ lot/วันหมดอายุไหม
6. **ขัดกับคำสั่งเดิม:** 6 ต.ค. เจ้าของสั่งให้ popup มุมจอ "หายไปหลัง 4 วินาที" ทุกใบ (รวม critical) แต่รอบนี้ระบุ "Critical Sticky" ข้อเสนอคือ popup ทุกใบยังหายใน 4 วินาทีตามเดิม แต่ critical จะ**ไปค้างเป็นแถบ/badge สีแดงบนกระดิ่ง (หรือ Exception Inbox) จนกว่าจะกดรับทราบ** ใช้แบบนี้ หรือให้ popup critical เองค้างบนจอ
7. เพิ่ม devDependency `@playwright/test` และให้แอปต่อ Firestore/Auth emulator ได้ผ่าน `VITE_USE_EMULATOR=1` (เฉพาะ test build, ห้ามติด production) ใช้ได้ไหม
8. ADR-001 ใช้ service account ตัวเดิมเขียน stock ผ่าน Functions ได้ไหม (ขยาย allowlist ของ `serverStore.ts` ให้รวม `stockMovements`, `stockLevels`, `counters`, `transfers`, `monthlyCounts`)

## Verification (เมื่อเริ่มทำแต่ละเฟส)

### Harness (T1)
- แอปตอนนี้ไม่มีการต่อ emulator เลย (ไม่มี `connectFirestoreEmulator` ใน `src`)
- ต้องเพิ่มใน `src/firebase/app.ts` ภายใต้ `VITE_USE_EMULATOR`
- รันด้วย `firebase emulators:exec --only firestore,auth "playwright test"` (Java มีแล้วเพราะ `test:rules` ใช้อยู่)
- **ใช้ local demo backend ไม่ได้สำหรับ concurrency** เพราะแต่ละ browser context มี storage แยกกัน
- seed ด้วย fixture เดียวกับ demo (`demoSeed.ts`) ผ่าน admin SDK ของ emulator
- ผู้ใช้ทดสอบ 3 บทบาทสร้างใน Auth emulator (รหัสอยู่ใน fixture ไม่ใช่ของจริง)

### Scenario ขั้นต่ำ (ทุกตัวเป็น exit gate)

| # | Scenario | Invariant ที่ต้องเป็นจริง |
|---|---|---|
| E1 | 2 client รับ PO เดียวกันพร้อมกัน (สอง browser context กด confirm ในเวลาเดียวกัน) | stock เพิ่มครั้งเดียว, PO receipts = 1, อีกเครื่องเห็นข้อความรับไปแล้ว |
| E2 | retry request เดิม (ตัดเน็ตหลังส่ง ด้วย `context.setOffline` / `route.abort` แล้วกดใหม่) | replay ไม่เขียนซ้ำ |
| E3 | PR convert double click + 2 แท็บ | PO ต่อผู้ขาย = 1 ใบ, PR `poCreated` ครั้งเดียว |
| E4 | movement แทรกระหว่าง count review/confirm | ยอดหลัง post = ยอดที่นับ |
| E5 | supplier เปลี่ยนวันที่ (เรียก `/api/supplier/:token` ผ่าน dev fixture) ขณะ user เปิด PO แล้ว amend | ไม่มีใครทับข้อมูลของอีกฝ่าย; amend ที่ stale ถูกปฏิเสธ/โหลดใหม่ |
| E6 | network fail ระหว่าง transaction (abort request ของ commit) | ไม่มีสถานะครึ่งทาง; UI บอกให้ลองใหม่; retry ปลอดภัย |
| E7 | stale tab submit (แท็บเก่าเปิดค้างแล้ว submit หลังอีกแท็บแก้ไปแล้ว) | ปฏิเสธพร้อมข้อความ ไม่ทับ |
| E8 | malicious client (Firestore SDK ตรงด้วย token staff) เขียน stockLevels / movement ปลอม / transferId ปลอม / แก้ PR หลังอนุมัติ | DENY ทั้งหมด |
| E9 | วงจรปกติ PR → PO → รับบางส่วน → incoming ถูก → รับที่เหลือ → โอน → นับ → post | Auditor = 0 mismatch หลังจบ |

### อื่นๆ

- **unit tests ใหม่ทุกข้อ A:**
  - receive tx (fake backend: ล้มกลางทาง, 2 เครื่อง, retry ด้วย receiptId)
  - `incomingFor` partial
  - convert ซ้ำ/ล้มกลางทาง
  - count diff ที่มี movement แทรก
- **rules tests:**
  - staff เขียน stockLevels ไม่ได้
  - transferId ปลอม
  - PR items หลัง approve
  - edit movement โดย staff
  - เทส budget กับเอกสารกว้างสุด
- **เดินจริงบน `npm run demo`:** PR → PO → รับบางส่วน → incoming ถูก → รับที่เหลือ → นับ → post
- **production:** อ่านอย่างเดียว ตรวจ bundle `main-*.js` ตรงกับ dist หลังเจ้าของสั่ง merge
