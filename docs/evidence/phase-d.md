# Phase D (Efficiency & UX) — หลักฐาน

แผน: ข้อ 16–21 (D1', D2', D3', D5', D6')
Branch: `claude/phase-a-ledger-continue-uzbbb5`

**สถานะ:**
- **D1', D2', D3', D5', D6' เสร็จ**
- **D4'** (Import Hub, รวม Batch เข้า PR, ตัดโหมดโอนใน Issue) รอเจ้าของตัดสินใจ (คำถามข้อ 4) จึงยังไม่ทำ

## เกณฑ์ข้อ 21 ของ Phase D

| เกณฑ์ | ผล | หลักฐาน |
|---|---|---|
| main chunk < 900 KB | **PASS** — **1,209 KB → 218 KB** | `npm run build && npm run check:bundle` |
| Lighthouse mobile TTI ดีขึ้น ≥ 30% | **ยังไม่ได้วัด** | ดูหมายเหตุด้านล่าง |
| readMeter นับ getOne | **PASS** | `src/backend/firestore.ts` |
| reads ต่อการเปิดแอปไม่เพิ่ม | **PASS** | `tests/quota-budget.test.ts`, `tests/quota-reads.test.ts` ผ่าน |

**JS ทั้งหมดที่โหลดตอนเปิดแอป:** 3.50 MB → 1.66 MB

**สิ่งที่ readMeter นับเพิ่ม:** `getOne` และ `subscribeOne` นับ 1 ครั้งต่อ snapshot ส่วน query ที่ว่างนับขั้นต่ำ 1 ตามที่ Firestore คิดเงิน

**ทำไม reads ไม่เพิ่ม:** intel อ่านเฉพาะตอนมีหน้าที่ใช้เปิดอยู่ และ range cache อ่านเฉพาะช่วงที่ขาด

**หมายเหตุ Lighthouse:**
- ใน container นี้ไม่มี Lighthouse และไม่มีเครื่องมือจำลองมือถือ/เครือข่าย จึงยังไม่มีตัวเลข TTI
- ตัวแทนที่วัดได้คือ JS ที่โหลดก่อนแสดงหน้าแรกลดลง 53%
- ควรรัน Lighthouse บน `npm run preview` ในเครื่องเจ้าของก่อน merge

## รายการ

| งาน | Commit | สิ่งที่ทำ |
|---|---|---|
| D1' | `7d7b28e` | ทุกหน้า ยกเว้น login และ dashboard โหลดเมื่อเปิดครั้งแรก (React.lazy) ถ้า chunk โหลดไม่ได้หลัง deploy จะตกไปที่ ErrorBoundary ซึ่งมีปุ่มโหลดใหม่ และเพิ่ม `scripts/bundle-budget.mjs` |
| D3' | `7e48710` | rangeCache อ่านเฉพาะช่วงที่ขาดแล้วรวมเป็นช่วงเดียว (`tests/range-cache.test.ts`) และ readMeter นับทุก read |
| D2' | `f3b26cb` | แยก notifications เป็น context ของตัวเอง (การแจ้งเตือนเข้าไม่ทำให้ทุกหน้า re-render) และ `SupplierIntelProvider` คำนวณครั้งเดียวเฉพาะตอนมีหน้าที่ใช้ |
| D5' | `7b40ab0` | เปิด pinch-zoom (ช่องกรอกบนมือถือ 17px กัน iOS ซูมเอง) และเพิ่มการ์ดมือถือใน RequestReview กับผลงานผู้ขาย |
| D6' | `e9d2f3b` | DataTable render เฉพาะ layout ของขนาดจอ (เดิม render ซ้ำ 2 ชุด) และเพิ่ม `paged` ให้ Movements / Transfers / Stock Card / Cost report |

**รายละเอียด D5':**
- Adjust มีการ์ดมือถืออยู่แล้ว
- toast ไม่ทับ tab bar แล้วตั้งแต่ C5
- **ไม่ prefill จำนวนรับ** เพราะเจ้าของเลือกไว้เมื่อ 24 ก.ย. ว่า "ไม่ prefill กดรับครบครั้งเดียว" ข้อนี้ขัดกับแผน จึงยึดคำสั่งเจ้าของ

## ผลเทส (หลัง `e9d2f3b`)

| ชุด | ผล |
|---|---|
| `npm test` | **1,237 ผ่าน** |
| e2e | **28 ผ่าน / 0 ล้ม** |
| build + `check:bundle` | ผ่าน |
| tsc / oxlint / i18n | ผ่าน |
