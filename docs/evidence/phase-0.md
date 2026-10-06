# Phase 0: หลักฐานตั้งต้น (Evidence base)

แผน: PZM Operations OS audit (อนุมัติ 6 ต.ค. 2569) ข้อ 20–22
Branch: `feat/integrity-auditor` · ฐาน: `origin/main` @ `7e5965e`
**สถานะ: PASS** (6 ต.ค. 2569 — baseline จาก backup ของจริงทั้งสองแบรนด์ ดูท้ายไฟล์)

## สิ่งที่ส่งมอบ

| ชิ้นงาน | ไฟล์ |
|---|---|
| Integrity Auditor (read-only, 6 หมวด) | `src/lib/integrityAudit.ts`, `tests/integrity-audit.test.ts` (16 เทส) |
| กติกา key ของยอดคงเหลือแยกเป็น module บริสุทธิ์ (การทำงานไม่เปลี่ยน) | `src/lib/levelKey.ts` (ย้ายออกมาจาก `services/stock.ts`) |
| ตรวจไฟล์ backup แบบออฟไลน์ (ไม่อ่าน Firestore เลย) | `scripts/integrity-audit.mjs` → `npm run audit:integrity -- <backup.json> [--json out.json]` |
| Playwright + Firestore/Auth emulator harness | `playwright.config.ts`, `e2e/*`, `.env.e2e`, `npm run test:e2e` |
| โหมด emulator สำหรับเทสเท่านั้น | `src/firebase/config.ts` `isEmulatorMode()`, `src/firebase/app.ts` |

## ความปลอดภัยของ harness

- **ทำงานเฉพาะเมื่อครบทุกเงื่อนไข:**
  - เปิดด้วย `--mode e2e` (มี `VITE_USE_EMULATOR=1`)
  - hostname เป็น `localhost` / `127.0.0.1`
  - project id เป็น `demo-pzm-e2e` (prefix `demo-` ทำให้ SDK ไม่ส่งข้อมูลไป Google)
- `vite.config.ts` ปฏิเสธ build บน Cloudflare Pages ถ้ามี flag นี้
- **ตรวจ bundle production** (`npm run build`): `dist/assets/main-*.js` มีคำว่า `VITE_USE_EMULATOR` / `demo-pzm-e2e` = **0** แห่ง เพราะโค้ดส่วนนี้ถูกตัดทิ้งตอน build
- แถบ "เซิร์ฟเวอร์ทดสอบนี้ต่อกับข้อมูลจริง" จะแสดงเป็น "ฐานข้อมูลจำลองสำหรับทดสอบ (emulator)" ในโหมดนี้

## ผลรัน (6 ต.ค. 2569)

| คำสั่ง | ผล |
|---|---|
| `npm test` | 96 ไฟล์ · **1,151 passed** |
| `npm run test:e2e` | **8 expected · 0 unexpected · 0 flaky** (33 วินาที) |
| `npm run lint` | 0 errors |
| `npm run i18n:check` | ครบ |
| `npm run build` | ผ่าน (รวม typecheck ของ `e2e/`) |

## Baseline ข้อบกพร่องที่พิสูจน์แล้วบนระบบจริง (ผ่าน emulator)

เทสที่ติด `test.fail` คือช่องโหว่ที่ยังอยู่ เมื่อแก้แล้วเทสจะแดง ให้ถอด marker ออกแล้วเทสนั้นจะกลายเป็นด่านถาวร

| Scenario | ค่าที่สังเกตได้ | ข้อ audit | แก้ใน |
|---|---|---|---|
| 2 เครื่องกดยืนยันรับ PO เดียวกันพร้อมกัน | flour **20** (ควรเป็น 10), stock rows **4** (ควรเป็น 2), PO receipts 1, status received | D1 | A1 |
| staff เขียน `stockLevels/wh__flour` qty 999 ตรงๆ | **HTTP 200** (ยอมให้เขียน) | S1 | ADR-001 |
| staff สร้าง movement โอนข้ามสาขาด้วย `transferId` ที่ไม่มีอยู่จริง | **HTTP 200** | S2 | A4 |
| staff แก้ qty ของ movement ที่บันทึกแล้ว | **HTTP 200** | S5 | A9 |
| staff สร้าง PO สถานะ `ordered` เองโดยไม่ผ่านอนุมัติ | **HTTP 200** | B4 (เจ้าของตัดสิน 6 ต.ค.) | B4 |

**เทสที่ต้องผ่านเสมอ (ผ่านแล้ว):**
- **control:** staff ตั้งตัวเองเป็น admin ไม่ได้ (403) ยืนยันว่า harness ใช้ rules จริง
- รับ PO ครบด้วยเครื่องเดียว: receipt 1 ใบ, stock 10, PO `received`
- Auditor บนข้อมูลที่แอปเขียนจริงหลังรับซ้ำ จับได้ `stockNotOnPo` และ `possibleDuplicateReceipt` ×2

## เกณฑ์ PASS ของ Phase 0 (ข้อ 21)

| เกณฑ์ | สถานะ |
|---|---|
| Playwright รันบน emulator ได้ 2 client พร้อมกัน | ✅ |
| Auditor รันบน backup JSON ของ production ได้รายงาน baseline ครบ 6 หมวด | ✅ (ด้านล่าง) |
| ไม่มี write ใดๆ ต่อ production | ✅ (ไม่มีคำสั่งไหนแตะ `pzm-stock-x5`) |

## Baseline ข้อมูลจริง (backup ที่เจ้าของดาวน์โหลด 6 ต.ค. 2569 15:00)

`npm run audit:integrity -- "D:\AI Solution\pzm-stock-<brand>-20261006-1500.json"` อ่านไฟล์อย่างเดียว ใช้ 0 reads

| แบรนด์ | ที่ตรวจ | critical | warning | info |
|---|---|---|---|---|
| Pizza Mania | สินค้า 336 · ยอดคงเหลือ 524 · movements 3,173 · PO 130 · PR 7 · transfers 0 | **0** | 1 | 1 |
| Le Lapin | สินค้า 170 · ยอดคงเหลือ 45 · movements 112 · PO 46 · PR 7 · transfers 0 | **0** | 0 | 0 |

**ยืนยันว่าตรวจกับข้อมูลจริง ไม่ใช่ผ่านเพราะว่างเปล่า:**
- **Pizza Mania:** PO ที่ผูกกับใบรับ 45 ใบ + แบบเก่า (movementDocNo) 57 ใบ · movement ที่อ้าง PO 77 แถว · void 44 แถว · ถูกแก้ 158 แถว · ยอดคงเหลือแบบ `#Unit` 37 key
- **Le Lapin:** PO ผูกใบรับ 23 + 9 ใบ · movement อ้าง PO 38 แถว
- **ยอดคงเหลือเทียบ ledger = 0 drift ทั้งสองแบรนด์**

**ข้อค้นพบ (ไม่แก้อัตโนมัติ รอเจ้าของตัดสิน):**
- Pizza Mania `movementMissingProduct` + `balanceForMissingMaster`:
  - สินค้าเก่า "SAUSAGE MIX DOLCE (FOOD WAY)" หน่วย EA (id `FkfvEOfOG5QQ4tYyNDj6`) ถูกลบไปแล้ว
  - แต่ยังมีใบรับ RC-00019 (7 เม.ย. 2569, 20 EA, ผู้รับ Nuiy) และ**ยอดคงเหลือ 20 EA ค้างที่คลังหลัก** ซึ่งมองไม่เห็นในแอป
  - ตอนนี้มีสินค้าชื่อเดียวกันตัวใหม่ (MES-01-03-002, หน่วย KG)
  - ตรงกับ D10 ในรายงาน audit (ลบสินค้าแล้ว ledger ยังชี้อยู่)

**ข้อสังเกตเพื่อเฟสถัดไป:**
- ยังไม่มีการใช้ระบบโอน (transfers = 0 ทั้งสองแบรนด์) หมวด transit จึงยังไม่มีข้อมูลจริงให้ทดสอบ
- ยังไม่มี PO ที่รับบางส่วนค้างอยู่ (partial = 0) และไม่มีบรรทัดเก่าที่ขาด baseQty
- **การแก้ A2 จึงไม่เปลี่ยนตัวเลขใดๆ ในวันนี้** ความเสี่ยงของ migration ต่ำ

**ข้อจำกัดที่ต้องรู้:** PO แบบเก่าก่อน 24 ก.ย. ไม่มีรายการใบรับ (`receipts`) จึงตรวจได้แค่ว่าเอกสารสต๊อกที่อ้างถึงมีอยู่จริง เทียบจำนวนรายบรรทัดไม่ได้
