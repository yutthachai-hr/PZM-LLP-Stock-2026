# Phase A: Ledger atomicity — หลักฐาน

แผน: `docs/PLAN-operations-os.md` ข้อ 19–21 (A1, A2, A6, A7, A8, A10)
Branch: `claude/phase-a-ledger-continue-uzbbb5` (ต่อจาก `feat/phase-a-ledger` @ `abef783`)
**สถานะ: PASS ทุกเกณฑ์ที่ทำได้ใน repo — เหลือ 1 ข้อที่ต้องรันบนเครื่องเจ้าของ (dry-run บน backup จริง ดูท้ายไฟล์)**

> client transaction = **atomicity ไม่ใช่ security** ช่องโหว่ฝั่ง token holder (S1, S2, S5, B4) ยังเปิดอยู่จนกว่าจะถึง A-rules / A-sec และยังติด `test.fail` อยู่ใน `e2e/hostile-client.spec.ts`

## งานที่ส่งมอบ

| ข้อ | สิ่งที่เปลี่ยน | ไฟล์หลัก |
|---|---|---|
| A1 | รับของจาก PO = tx เดียว, idempotent ด้วย `operationId` | `services/purchaseOrders.ts` `receivePurchaseOrder` |
| A2 | ยอดค้างรับตามหน่วยฐาน helper เดียว + legacy ติดธง estimated | `lib/inventoryRules/purchasing.ts` `remainingBaseQty` |
| A2 backfill | dry-run บน backup (อ่านอย่างเดียว ไม่มีโหมดเขียน) | `lib/poBaseQtyBackfill.ts`, `scripts/backfill-po-baseqty.mjs` |
| A6 | PR → PO = tx เดียว, PO id `po_<pr>_<supplier>`, replay, เครื่องมือซ่อม PR ค้าง | `services/purchaseRequests.ts` `convertToOrders`, `lib/requestConversion.ts`, `pages/settings/StuckRequestsSection.tsx` |
| A7 | amend / cancel / closeRemainder อ่านและเขียน PO ใน tx | `services/purchaseOrders.ts` `changeOrder` |
| A8 | แถวที่รับจาก PO แก้ได้เฉพาะหมายเหตุ ห้าม void (ให้ใช้ปรับสต๊อก) | `services/stock.ts` `editMovement` / `voidMovement`, `EditMovementModal`, `Movements` |
| A10 | ผลต่างนับเดือนคำนวณใน tx จากยอด ณ ขณะนั้น; ยอดขยับระหว่างทาง → อ่านใหม่แล้วลองใหม่ | `services/monthlyCounts.ts` `postMonthlyCount` |

**ทำไม A8 เลือก "ห้าม" แทน "sync":** rules ปัจจุบันไม่ยอมให้ลบ receipt ออกจาก PO และไม่ยอมให้ PO `received` กลับเป็น `ordered` จึง sync PO ตามการแก้/void แถวไม่ได้โดยไม่แก้ rules ถ้าเจ้าของต้องการ "ยกเลิกใบรับทั้งใบแล้ว PO กลับไปรอรับ" ต้องทำพร้อมรอบ A-rules

## เกณฑ์ PASS ของ Phase A (ข้อ 21)

| เกณฑ์ | ผล | หลักฐาน |
|---|---|---|
| duplicate receipt = 0: 2 client พร้อมกัน | ✅ flour 10, rows 2 | e2e `receive-po` "two devices…" |
| duplicate receipt = 0: retry operationId เดิม ×5 | ✅ docNo เดียว, rows 2, receipts 1 | unit `purchase-orders` "retry ×5…" |
| duplicate receipt = 0: network fail กลาง tx | ✅ | e2e `receive-po` "the answer is lost…" |
| incoming ถูก 100% (รับบางส่วน/รับเกิน/legacy/หลายหน่วย) | ✅ | unit `incoming.test.ts` |
| PR double conversion = 0 (double click, 2 แท็บ, คำตอบหาย) | ✅ PO ต่อผู้ขาย 1 ใบ, counter ขยับครั้งเดียว | e2e `convert-request` ×4 + ซ่อม PR ค้าง ×1 |
| count concurrency invariant (movement แทรก review→confirm) | ✅ ลง −5 ครั้งเดียว ยอดวันนับ = ยอดนับ | e2e `count-post`, unit `monthly-count-post` (เทสแดงเมื่อถอดการตรวจ) |
| edit/void movement ผูก PO แล้ว PO ตรง ledger | ✅ (ห้ามเปลี่ยน → ไม่มีทางไม่ตรง) | unit `purchase-orders` A8 ×3 |
| amend/cancel แข่งกับการรับ | ✅ 3/3 สอดคล้อง | e2e `order-changes`, unit A7 ×2 |
| regression เดิมผ่าน (`npm test` ≥ เดิม, `test:rules`) | ✅ 1,187 ≥ 1,169 · rules 217 | ด้านล่าง |
| Auditor บนข้อมูล demo = 0 mismatch | ✅ 0 critical / 0 warning หลังวงจร PR → PO → รับ → นับ → post | e2e `full-cycle` |
| backfill dry-run บน backup จริง | ⏳ **ต้องรันบนเครื่องเจ้าของ** (ไฟล์ backup อยู่ที่ `D:\AI Solution\…` ไม่ได้อยู่ใน repo) | script พร้อม เทสด้วยไฟล์สังเคราะห์แล้ว: set 1, GAP 1 (`noRate`) exit 1 |

## ผลรัน (6 ต.ค. 2569)

| คำสั่ง | ผล |
|---|---|
| `npm test` | 99 ไฟล์ · **1,187 passed** |
| `npm run test:rules` | 7 ไฟล์ · **217 passed** |
| `npm run test:e2e` | **17 expected · 0 unexpected · 0 flaky** (2.6 นาที; 4 ข้อใน hostile-client ยังเป็น `test.fail` ตามแผน) |
| `npm run lint` | 0 errors |
| `npm run i18n:check` | ครบ |
| `npm run build` | ผ่าน · `main-*.js` มีคำว่า `VITE_USE_EMULATOR` / `demo-pzm-e2e` = 0 แห่ง |

## ข้อที่ต้องให้เจ้าของทำ

1. รัน dry-run บน backup ล่าสุดทั้งสองแบรนด์ แล้วแนบผลมาในไฟล์นี้
   ```bash
   npm run backfill:po-baseqty -- "D:\AI Solution\pzm-stock-<brand>-<date>.json" --json plan.json
   ```
   - exit 0 = ทุกบรรทัดคำนวณได้
   - exit 1 = มี GAP ต้องกำหนดอัตราแปลงที่หน้าสินค้าก่อน
   - การเขียนค่าจริงยังไม่มีในโค้ด ต้องสั่งแยก
2. ตัดสินว่าจะ merge branch นี้เข้า `feat/phase-a-ledger` / main เมื่อไร
