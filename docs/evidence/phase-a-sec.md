# Phase A-sec (ADR-001) — หลักฐาน

แผน: ข้อ 15A + 20 (A3)
Branch: `claude/phase-a-ledger-continue-uzbbb5`
**สถานะ:**
- **PASS บน emulator สำหรับ staff และหัวหน้า** ไม่มีทางเขียน `stockLevels` / `stockMovements` จาก client อีกแล้ว
- **ยังไม่ครบตาม ADR ข้อสุดท้าย** ("DENY ทุกบทบาท รวมแอดมิน") เพราะเครื่องมือดูแลข้อมูลของแอดมินยังเขียนจาก client (ดูท้ายไฟล์)
- **ยังไม่ deploy** ต้องทำตามลำดับด้านล่างเท่านั้น

## โครงสร้าง

| ชิ้น | ไฟล์ |
|---|---|
| ตัว transaction ของ stock ทั้งหมด ไม่พึ่ง Firebase client (ใช้ร่วมกันทั้งแอปและ server) | `src/commands/ledgerTx.ts`, `receivePO.ts`, `countPost.ts`, `transferTx.ts` |
| คำสั่ง (ชื่อ, บทบาท, สิ่งที่เขียนได้, ตรวจ parameter) | `src/commands/stockCommands.ts`, `transferCommands.ts`, `countPost.ts` |
| Transaction ฝั่ง server บน service account (อ่าน → precondition ทุกเอกสาร → `:commit` ครั้งเดียว, `verify` สำหรับเอกสารที่แค่อ่าน, ลองใหม่เมื่อแพ้ race) | `functions/_lib/serverTx.ts`, `serverStore.ts` (`commit`, `query`) |
| Endpoint เดียว `POST /api/stock/<command>` | `functions/api/stock/[command].ts`, `functions/_lib/stockCommands.ts` |
| แอป: `execute()` ส่งไป server เมื่อ build เปิด `VITE_STOCK_COMMANDS` (ไม่งั้นใช้ทาง client เดิม; ถ้า server ตอบ 503 ก็ใช้ทาง client) | `src/services/stock.ts`, `src/lib/stockCommands.ts`, `.env.production` |

**คำสั่ง 11 ตัว:**
- `receivePO`
- `receiveStock`
- `issueStock` (หัวหน้า)
- `consumeStock`
- `adjustStock`
- `fileCount` (แอดมิน)
- `postCount` (หัวหน้า)
- `approveTransfer` (หัวหน้า)
- `receiveTransfer` (เฉพาะสาขาปลายทาง)
- `resolveDiscrepancy` (หัวหน้า)
- `resolveMisroute` (หัวหน้า)

**สิ่งที่ server ไม่เชื่อจาก request:**
- **ผู้ทำรายการ:** ใช้ชื่อ บทบาท และสาขาจาก `users/{uid}` ของ token เท่านั้น
- **ตัวเลขยอด:** server คำนวณเองจากสิ่งที่อ่าน
- **ยอดนับประจำเดือน:** อ่านจากใบนับใน tx
- **บรรทัดของเอกสารโอน:** สร้างใหม่จาก field ที่รู้จักเท่านั้น
- **key ที่ไม่รู้จัก:** ปฏิเสธ (400) ไม่ใช่แค่ไม่สนใจ

## เกณฑ์ PASS (ข้อ 21, ต่อ command)

| เกณฑ์ | ผล | หลักฐาน |
|---|---|---|
| handler: auth / role / inactive / revoked | ✅ | `tests/functions/stock-commands.test.ts` |
| คำนวณยอดฝั่ง server | ✅ | ทุกคำสั่ง |
| replay (operationId เดิม) | ✅ | receivePO |
| precondition conflict (มีคนเขียนระหว่างอ่านกับ commit; เอกสารที่แค่อ่านเปลี่ยน) | ✅ | ทั้งสองกรณี |
| allow-list การเขียนต่อคำสั่ง (pin ด้วยเทส) + ชื่อคำสั่งที่ไม่มี / สืบทอดมา (`toString`) = 404 | ✅ | |
| golden comparison (ยอด/แถว/counter/เอกสาร ตรงกับทาง client ทุก scenario) | ✅ | ครบ 11 คำสั่ง ทั้ง Pizza Mania และ Le Lapin, วงจรโอนเต็ม (อนุมัติ → รับขาด → ตัดสูญหาย), นับเดือน |
| E2E เดิมผ่านผ่าน command | ✅ 20/0/0 | `.env.e2e` `VITE_STOCK_COMMANDS=all`; e2e ยืนยันว่าเรียก `/api/stock/receivePO` และ `/api/stock/postCount` จริง (ไม่ได้ fallback เงียบ); `e2e/command-server.mjs` รัน handler ตัวจริงบน emulator ผ่าน REST |
| client write `stockLevels`/`stockMovements` = DENY | ✅ staff + หัวหน้า (S1 ถอด `test.fail` แล้ว) · ⏳ **แอดมินยังเขียนได้** | rules `clientStockWrite`; e2e hostile S1; rules tests |

## ลำดับ deploy (สำคัญ — ห้ามสลับ)

1. **ตั้ง secret `FIREBASE_SERVICE_ACCOUNT`** ใน Cloudflare Pages (Production)
   - ตัวเดียวกับที่ใช้กับลิงก์ยืนยันผู้ขาย สิทธิ์ `roles/datastore.user`
   - ถ้ายังไม่ตั้ง คำสั่งจะตอบ 503 และแอปใช้ทาง client เดิม
2. **deploy แอป** (merge → Pages build อ่าน `.env.production` → `VITE_STOCK_COMMANDS=all`)
3. **ตรวจว่าคำสั่งทำงานจริง** รับของ 1 ครั้ง → DevTools ต้องเห็น `POST /api/stock/receivePO` ตอบ **200** (ไม่ใช่ 503)
4. **deploy rules ทีหลังสุด** (`firebase deploy --only firestore:rules` + reauth)
   - ถ้า deploy rules ก่อนข้อ 3 ผ่าน พนักงานจะบันทึกสต๊อกไม่ได้เลย
   - rules ชุดนี้รวม A-rules ไว้ด้วย ดู `phase-a-rules.md` เรื่อง void

**ย้อนกลับ:**
- ก่อนข้อ 4 → ลบ `VITE_STOCK_COMMANDS` แล้ว redeploy แอป
- หลังข้อ 4 → ต้องถอย rules ก่อน แล้วค่อยถอยแอป

## ที่ยังเหลือ (แอดมิน)

ทางที่ยังเขียนยอด/แถวจาก client ทั้งหมดเป็นของแอดมิน rules ยังอนุญาตเฉพาะแอดมิน:
- แก้/void movement (`editMovement`, `voidMovement`)
- เปลี่ยนหน่วย (`changeProductUnit`, `unitRebase`, `unitMigration`)
- คำนวณยอดใหม่ (`recomputeLevels`, `rebuildProductLevels`)
- นำเข้า Excel (`importStock` ผ่าน `fileCount` แล้ว ส่วนอื่นยังไม่)
- กู้คืน backup (`restoreBackup`)
- ลบสินค้า/คลังที่ลบยอดคงเหลือไปด้วย

เมื่อย้ายครบ → แก้ `clientStockWrite` เป็น `false` ตาม ADR ข้อสุดท้าย

## ผลรัน (6 ต.ค. 2569)

| คำสั่ง | ผล |
|---|---|
| `npm test` | **1,208 passed** |
| `npm run test:rules` | **218 passed** |
| `npm run test:e2e` | **20 expected · 0 unexpected · 0 flaky**, ไม่มี `test.fail` เหลือ |
| lint / i18n / build / tsc functions + e2e | ผ่าน |
