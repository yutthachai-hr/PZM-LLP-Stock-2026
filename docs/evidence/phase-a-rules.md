# Phase A-rules — หลักฐาน

แผน: ข้อ 20 (A4, A5, A9, B7) + B4 (เจ้าของตัดสิน 6 ต.ค. 2569)
Branch: `claude/phase-a-ledger-continue-uzbbb5`
**สถานะ: PASS บน emulator — ยังไม่ deploy** ต้องให้เจ้าของยืนยัน + reauth แล้วสั่ง `firebase deploy --only firestore:rules` เอง

## กฎที่เปลี่ยน (`firestore.rules`)

| ข้อ | กฎ | ผลกับคนใช้งาน |
|---|---|---|
| A4 | movement ที่มี `transferId` ต้องชี้เอกสารโอนที่มีอยู่จริง และสถานะผ่านขั้นอนุมัติแล้ว (`inTransit` ขึ้นไป) ตรวจด้วย `getAfter` ภายใน write เดียวกัน | ไม่มี — แอปเขียนแถวโอนพร้อมเอกสารเสมอ |
| A5 | PR ที่ `approved` / `poCreated` แก้ `items` ไม่ได้; `approved → poCreated` ต้องมี history รายการสุดท้าย `convertedToPo` ที่ `by` = ผู้เรียก | ไม่มี — แอปเขียนแบบนี้อยู่แล้ว จึง deploy ได้ไม่ต้องรอแอป |
| A9 | แก้ qty/date/note/unit/location ของ movement = **แอดมินเท่านั้น** (ลงชื่อใน `edits`); void = แอดมิน + `voidReason` ไม่ว่าง | **พนักงาน/หัวหน้าแก้แถวที่บันทึกแล้วไม่ได้อีก** (รวมปุ่ม "แก้ไข" ในรายการวันนี้) ให้แจ้งแอดมิน หรือบันทึกปรับสต๊อก |
| B7 | movement `adjust` ต้องมี `reason` อยู่ใน `lost, broken, expired, damage, found, count, opening` | ไม่มี — service ตรวจเหมือนกันอยู่แล้ว |
| B4 | พนักงานสร้าง PO `ordered` เองไม่ได้ ยกเว้นมาจาก PR ที่แปลงในการเขียนเดียวกัน (`getAfter(PR).status == poCreated`); `draft → ordered` = หัวหน้า/แอดมิน | **ใบที่พนักงานสั่งเองเป็นร่าง "รออนุมัติ"** หัวหน้า/แอดมินกด "อนุมัติสั่งซื้อ" ในรายการหรือแผงขวา; อนุมัติชุด Excel = หัวหน้า/แอดมิน |

## แอปที่เปลี่ยนคู่กัน

- `voidMovement(id, actor, reason)` ถามเหตุผลผ่าน `ReasonModal` (หน้าเคลื่อนไหว)
- ปุ่มแก้ไข movement แสดงเฉพาะแอดมิน (หน้าเคลื่อนไหว + รายการวันนี้)
- `createPurchaseOrder({ asDraft })` พนักงานสั่งเอง → ร่าง; ปุ่ม "อนุมัติสั่งซื้อ" ในหน้าสั่งซื้อ (แถว + แผงขวา) สำหรับหัวหน้า/แอดมิน; ซ่อนปุ่มอนุมัติชุด Excel จากพนักงาน
- ทุกข้อเป็นทั้งข้อจำกัดใน UI และใน rules

## ลำดับ deploy (สำคัญ)

แอปกับ rules ต้องขึ้น**ในช่วงเวลาเดียวกัน** (ห่างกันไม่กี่นาที) เพราะเข้ากันไม่ได้ข้ามรุ่นอยู่เรื่องเดียว คือการยกเลิก (void) movement:
- **แอปใหม่ + rules เดิม:** void ถูกปฏิเสธ เพราะ rules เดิมไม่รู้จัก field `voidReason`
- **แอปเดิม + rules ใหม่:** void ถูกปฏิเสธ เพราะไม่มีเหตุผล

ระหว่างสองขั้นนี้อย่าเพิ่งกด void นอกจากนั้นใช้ข้ามรุ่นได้

rules ใหม่ตั้งใจปิดพฤติกรรมของแอปเดิมสามอย่าง:
- พนักงานแก้ movement
- พนักงานสร้าง PO `ordered`
- void ที่ไม่มีเหตุผล

## เกณฑ์ PASS (ข้อ 21)

| เกณฑ์ | ผล | หลักฐาน |
|---|---|---|
| staff direct stock write = DENY | ⏳ **ยังเปิด (S1)** — rules พิสูจน์ยอดไม่ได้ ปิดได้เมื่อ A-sec ย้ายการเขียนยอดไป command ครบ (ADR-001) | e2e `hostile-client` S1 ยังเป็น `test.fail` |
| fake transferId = DENY | ✅ | e2e S2 (ถอด `test.fail` แล้ว), rules `transfers-rules` |
| approved PR item modification = DENY | ✅ | e2e A5, rules `firestore-rules` purchase requests |
| staff movement edit = DENY | ✅ | e2e S5 (ถอด `test.fail` แล้ว), rules ×4 |
| void ไม่มีเหตุผล = DENY | ✅ (แอดมินด้วย) | e2e A9, rules |
| reason นอก enum = DENY | ✅ | e2e B7 |
| staff สร้าง PO `ordered` = DENY | ✅ | e2e B4 (ถอด `test.fail` แล้ว), rules |
| legitimate workflows = ALLOW | ✅ รับ PO, PR→PO (staff ด้วย), ยกเลิก/แก้ PO, นับ→post, วงจรเต็ม | e2e `receive-po`, `convert-request`, `order-changes`, `count-post`, `full-cycle`; rules tests เดิมทั้งหมด |
| budget test เอกสารกว้างสุด (headroom ≥ 50) | ✅ ผ่าน / ⚠️ **วัด headroom เป็นตัวเลขไม่ได้** | emulator ไม่รายงานจำนวน expression; กฎใหม่อยู่บน create ของ movement/PO (เอกสารแคบ) และบน PR update เพิ่ม ~4 expression; `firestore-rules-budget` (PR 200 บรรทัด + history 499) ยังผ่าน |

## ผลรัน (6 ต.ค. 2569)

| คำสั่ง | ผล |
|---|---|
| `npm test` | **1,187 passed** |
| `npm run test:rules` | **217 passed** (แก้เทสเดิม 11 ข้อให้ตรงนโยบายใหม่ แต่ละข้อยังเฝ้าเรื่องเดิม เปลี่ยนแค่บทบาทที่ได้รับอนุญาต) |
| `npm run test:e2e` | **20 expected · 0 unexpected · 0 flaky** (S1 ยังเป็น `test.fail`) |
| lint / i18n / build | 0 errors / ครบ / ผ่าน |
