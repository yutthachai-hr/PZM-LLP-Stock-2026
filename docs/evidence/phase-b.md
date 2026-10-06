# Phase B (Control & audit) — หลักฐาน

แผน: ข้อ 16–21 (B1–B6)
Branch: `claude/phase-a-ledger-continue-uzbbb5`
**สถานะ:**
- **B1, B3, B5, B6 PASS** บน unit + emulator
- **B2 ยังไม่ทำ** เพราะต้องสร้าง collection ใหม่ `auditLog` ซึ่งเจ้าของยังไม่ได้ตอบ (คำถามข้อ 2)
- **B4** ทำไปแล้วใน Phase A-rules (`docs/evidence/phase-a-rules.md`)
- **ยังไม่ deploy** (rules / Functions เป็นงานของเจ้าของ)

เกณฑ์ข้อ 21 ของ Phase B มี 3 ข้อ:
1. ทุก action มีแถว audit → **รอ B2** จึงยังไม่ PASS
2. backdate เข้าเดือนที่ปิดแล้วถูกปฏิเสธ → **PASS**
3. ลบสินค้า/สถานที่ที่มี ledger ถูกปฏิเสธ → **PASS**

**สรุป: Phase B ยังไม่ผ่านเกณฑ์ merge ครบ จนกว่าเจ้าของจะตอบเรื่อง `auditLog`**

## Commits

| Commit | งาน |
|---|---|
| `e529887` | B6 + B3 |
| `b663a6d` | B1 |
| `10cbc10` | B5 |

## B1 Period lock

- `requireOpenPeriod()` ใน `src/commands/ledgerTx.ts` อ่าน `monthlyCounts/<location>__<YYYY-MM>` ภายใน transaction ของทุกคำสั่งที่ขยับสต๊อก ได้แก่ รับ, รับจาก PO, เบิก, ใช้, ปรับ, นับ
- ถ้าเดือนนั้นที่คลังนั้น post ยอดนับแล้ว จะปฏิเสธด้วยข้อความ "เดือน {month} ของคลังนี้ปิดยอดนับแล้ว"
- อยู่ในตัว transaction ที่ใช้ร่วมกัน จึงบังคับทั้งทาง client และทาง server command
- คลัง transit ไม่มีการนับ จึงไม่ล็อก
- **แอดมิน**แก้แถวในเดือนที่ปิดแล้วได้ แต่ต้องใส่เหตุผล ซึ่งจะเก็บใน edit history (`periodOverride`)
- เทส: `tests/period-lock.test.ts`

## B3 ห้าม hard delete ที่มี ledger

- `deleteProduct` / `deleteLocation` ปฏิเสธถ้ามี movement แม้แต่แถวเดียว และบอกให้ "ปิดใช้งานแทน"
- ของเดิม: การลบสินค้าจะลบยอดคงเหลือ แต่แถว movement ยังอยู่ ซึ่งเป็นต้นเหตุของ SAUSAGE MIX 20 EA ที่มองไม่เห็น (Phase 0)
- เทส: `tests/no-hard-delete.test.ts`

## B5 ตีกลับตอนรับ + เพดานรับเกิน

- แต่ละบรรทัดของการรับจาก PO ระบุ **จำนวนที่ตีกลับ** และ **เหตุผล** ได้ เหตุผลต้องเป็นค่าใน enum `REJECT_REASONS`: เสียหาย / หมดอายุ / ส่งผิดรายการ / คุณภาพไม่ผ่าน / อื่นๆ
- ของที่ตีกลับ:
  - เก็บไว้ใน `PoReceipt.lines[].rejectedQty` / `rejectReason`
  - ต่อท้ายหมายเหตุของแถว stock เป็น "ตีกลับ N (เหตุผล)"
  - **ไม่เข้าสต๊อก** และบรรทัดยังค้างรับ
- การตีกลับพร้อมเหตุผลนับเป็นคำอธิบายของบรรทัดที่ขาดได้ ไม่ต้องพิมพ์เหตุผลซ้ำ
- ถ้าตีกลับทั้งใบจะไม่มีอะไรบันทึก ("ไม่มีรายการที่รับเข้า")
- **เพดานรับเกิน:** พนักงานรับเกินยอดค้างได้ไม่เกิน 10% (`OVER_RECEIPT_TOLERANCE`) หัวหน้าหรือแอดมินรับเกินได้
  - ทาง server ใช้บทบาทจาก `users/{uid}` ไม่ใช่จาก request
- หน้าจอ: ปุ่ม "+ ตีกลับ / ไม่รับของบางส่วน" ใต้แต่ละบรรทัดใน `src/pages/receive/PoLines.tsx`
- เทส:
  - `tests/purchase-orders.test.ts` › plan B5 (5 ข้อ)
  - `tests/functions/stock-commands.test.ts` › plan B5 through the server command (2 ข้อ)

## B6 Endpoint เช็คว่าผู้ใช้ยังใช้งานอยู่

- `functions/_lib/activeUser.ts` `stillActive()` ใช้กับ `ocr-bill` และ `po-image`
- เงื่อนไข: `users/{uid}.active` ต้องเป็นจริง และต้องไม่มีชื่ออยู่ใน `revokedUsers`
- ของเดิม: token ที่ยังไม่หมดอายุใช้ได้นานถึง 1 ชั่วโมงหลังถูกปิดบัญชี
- เทส: `tests/functions/active-user.test.ts`

## ผลเทส (หลัง `10cbc10`)

| ชุด | ผล |
|---|---|
| `npm test` | 103 ไฟล์, **1,223 ผ่าน** |
| `npm run test:rules` | **218 ผ่าน** |
| e2e (emulator, Playwright) | **20 ผ่าน / 0 ล้ม / 0 flaky** |
| `npx tsc -b` + `functions` tsc | ผ่าน |
| oxlint | 0 errors |
| `npm run i18n:check` | ครบ |
| build | ผ่าน |

## ค้าง

- **B2:** รอเจ้าของอนุมัติ collection `auditLog`
  - เมื่ออนุมัติ: เขียนแถว audit ใน tx เดียวกับ master data, users, settings, delete และ maintenance
  - rules: create-only และไม่มีใครแก้ได้
- เครื่องมือดูแลข้อมูลของแอดมินยังเขียนจาก client ตามที่บันทึกไว้ใน `phase-a-sec.md`
