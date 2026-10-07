# Supabase Shadow Migration Foundation: หลักฐาน (7 ต.ค. 2569)

**Branch:** `feat/supabase-shadow` (แตกจาก `main` @ `2a8d578` ซึ่งขึ้นจริงแล้ว)
**สถานะ:** ทำบนเครื่องเท่านั้น ยังไม่มี Supabase project
- ไม่มีอะไรแตะ production, Firestore หรือ client
- Firestore ยังเป็น source of truth
- ไม่มี dual-write
- ไม่มี cutover

ส่วน S0 (Firestore read budget) อยู่ที่ `docs/evidence/firestore-read-budget.md`

## สรุปผล

**Parity บนข้อมูลจริง** จากไฟล์ backup 6 ต.ค. 15:00 ทั้งสองแบรนด์ ด้วย `npm run shadow -- parity`

```
PARITY pizza — PASS                         PARITY lelapin — PASS
locations: 3 / 3 PASS                       locations: 3 / 3 PASS
suppliers: 86 / 86 PASS                     suppliers: 45 / 45 PASS
products: 336 / 336 PASS                    products: 170 / 170 PASS
product_aliases: 11 / 11 PASS               product_aliases: 0 / 0 PASS
purchase_requests: 7 / 7 PASS               purchase_requests: 7 / 7 PASS
purchase_orders: 130 / 130 PASS             purchase_orders: 46 / 46 PASS
purchase_order_lines: 221 / 221 PASS        purchase_order_lines: 81 / 81 PASS
receipts: 534 / 534 PASS                    receipts: 65 / 65 PASS
receipt_lines: 900 / 900 PASS               receipt_lines: 112 / 112 PASS
stock_movements: 3173 / 3173 PASS           stock_movements: 112 / 112 PASS
transfers / transfer_lines: 0 / 0 PASS      transfers / transfer_lines: 0 / 0 PASS

stock_balance (ledger: Firestore rule vs SQL)
  481 combinations, 481 equal, 0 mismatches   36 combinations, 36 equal, 0 mismatches
stock_balance (cached: stockLevels vs shadow)
  524 combinations, 524 equal, 0 mismatches   45 combinations, 45 equal, 0 mismatches
Firestore's own cached-vs-ledger drift: 0     0
```

- **Backfill ใช้เวลา:** Pizza 5.0 วินาที, Le Lapin 0.8 วินาที
- **ผลเทส:** `tests/shadow/*` ผ่าน 16 ข้อบน PostgreSQL 17 จริง (PGlite): migrations, RLS, backfill resume, replication idempotency, parity ที่จับข้อมูลที่ถูกแก้ได้

## 1–2. Schema และ migrations

ไฟล์ `supabase/migrations/0001…0004.sql`

**Identity:**
- ทุกแถวใช้ id ของ Firestore เดิม คีย์คู่กับ `brand` เพราะ id เดียวกันมีได้ทั้งสองแบรนด์ เช่น location `transit`
- **ไม่สร้าง identity ใหม่ให้ record เดิม**
- แถวลูกของ array (PO lines, PR lines, transfer items) ใช้ตำแหน่งใน array (`idx` ถ้ามี)
- receipts ใช้เลขเอกสาร `docNo` ที่มีอยู่แล้ว

**ข้อจำกัด:**
- FK: lines → parent, unit_conversions → products, receipt_lines → receipts + stock_movements
- unique: supplier code, `receipt_id` (กันรับซ้ำของ A1), prediction ต่อ engine × entity × inputs_as_of
- check: qty > 0, สถานะเป็น enum, from ≠ to, confidence 0–1
- soft delete (`deleted_at`) สำหรับ master data
- `version` = `updatedAt` (ms) ใช้กันการเขียนทับด้วยข้อมูลเก่ากว่า
- เก็บ `doc jsonb` เอกสารต้นฉบับทุกแถว จึงไม่มีฟิลด์หาย และ parity เทียบทั้งเอกสารได้

**ความ reproducible:**
- apply บนฐานใหม่สองรอบได้ schema เท่ากัน (เทส)
- CLI บันทึกใน `public.shadow_migrations` จึงไม่ apply ซ้ำ
- `npm run shadow -- bundle` ได้ไฟล์ SQL เดียวสำหรับ Supabase SQL editor

**ตารางทั้งหมด:**
- master: products, locations, suppliers, supplier_products, unit_conversions, product_aliases, app_users
- purchasing: purchase_requests (+lines), purchase_orders (+lines)
- ledger: receipts (+lines), stock_movements, stock_balances, view `stock_balance_from_ledger`
- transfers (+lines)
- notifications + notification_recipients, audit_log
- Phase G: supplier_metrics, delivery_risks, inventory_risks, prediction_snapshots
- replication: outbox_events, migration_checkpoints, parity_runs, view `replication_status`

## 3. Mapping Firestore → Supabase

`src/shadow/mapping.ts` เป็นฟังก์ชัน pure ใช้ร่วมกันระหว่าง backfill และ replicator

| Firestore | Supabase | หมายเหตุ |
|---|---|---|
| `users/{uid}` | `app_users(uid)` | role, active, siteIds → site_ids |
| `locations` | `locations` | type `transit` ตาม id/type |
| `suppliers` | `suppliers` | |
| `products` (+`unitConversions[]`) | `products` + `unit_conversions` | label ซ้ำ: เก็บตัวแรก (ตรงกับที่ engine ใช้) |
| `supplierItems` | `supplier_products` | |
| `productAliases` | `product_aliases` | |
| `purchaseRequests` (+`items[]`) | `purchase_requests` + `purchase_request_lines` | |
| `purchaseOrders` (+`lines[]`, `receipts[]`) | `purchase_orders` + `purchase_order_lines` + ผูก `receipts.po_id/receipt_id` | PO เก่าใช้ `movementDocNo` |
| `stockMovements` | `stock_movements` (+ `receipts`/`receipt_lines` สำหรับ receive) | receipt_id มาจาก id `rc_<po>_<op>_n` |
| `stockLevels` | `stock_balances` | `unit_key` = ส่วนหลัง `#` ของ level id |
| `transfers` (+`items[]`) | `transfers` + `transfer_lines` | |

**กติกายอดคงเหลือใน SQL** ตรงกับ `src/lib/levelKey.ts`: แถวที่มี entryUnit แต่ไม่มี entryQty นับเป็นยอดของหน่วยนั้น (`#Unit`) และแถวที่ void ไม่นับ ยืนยันด้วย parity 0 mismatches บนข้อมูลจริง

## 4. Outbox (ออกแบบแล้ว ยังไม่ wire ฝั่ง Firestore)

```
ธุรกรรมใน Firestore (เช่น receivePurchaseOrder ของ A1)
  └─ ใน transaction เดียวกัน: outbox/{eventId} = { eventId (uuid), eventType, entityType, entityId,
     entityVersion (updatedAt), occurredAt, createdAt, schemaVersion, payload (เอกสารหลัง commit) }
     → มี event ก็ต่อเมื่อธุรกรรม commit จริง ไม่มีครึ่งทาง
```

- client เขียน Firestore ที่เดียว และ**ไม่มีโค้ด client ใดเขียน Supabase**
- การเพิ่ม collection `outbox` ต้องแก้ rules + ให้เจ้าของอนุมัติ (กติกาข้อ 7) **จึงยังไม่ทำ**
- ทางที่แนะนำคือ wire ใน command boundary ฝั่ง server (ADR-001) พร้อมกับการย้ายคำสั่งสต๊อก เพราะ server เป็นผู้เขียน event ที่ client ปลอมไม่ได้

## 5. Replication

`src/shadow/replicate.ts` ออกแบบให้ cron Worker ใช้ service role

1. `ingest(events)`: insert เข้า `outbox_events` ด้วย `on conflict (event_id) do nothing` ทำให้ event ที่ส่งซ้ำถูกเก็บครั้งเดียว
2. `applyPending()`: ทีละ event ใน transaction ของตัวเอง map แล้ว upsert พร้อม version guard แล้วอัปเดตสถานะ
   - `applied`
   - `skipped_stale` (เวอร์ชันเก่ากว่าที่มีอยู่ ไม่เขียนทับ)
   - `failed` → retry
   - `dead` เมื่อครบ `maxAttempts` (คงไว้ให้เห็นใน `replication_status.dead_letter` **ไม่ทิ้ง**)
   - ลบแบบ soft สำหรับ master data, ลบจริงสำหรับเอกสาร
3. **เทสที่ผ่าน:**
   - event เดียวกันส่งซ้ำ → ถูกเก็บ 1 และ apply 1 ครั้ง
   - event เก่ามาทีหลัง → `skipped_stale` และไม่ทับข้อมูลใหม่
   - delete ทำงานถูก
   - event ที่ล้ม → retry 2 ครั้งแล้ว dead-letter พร้อม `last_error`

## 6. Backfill

`npm run shadow -- backfill <backup.json> [--run id]` (`src/shadow/backfill.ts`)

- **อ่านจากไฟล์ backup เท่านั้น:** 0 Firestore reads และไม่เขียน Firestore
- **ทำต่อจากจุดที่ล้มได้:**
  - ทุก chunk commit พร้อม `migration_checkpoints` ใน transaction เดียว
  - รันซ้ำด้วย run id เดิมจะทำต่อหลัง chunk สุดท้ายที่ commit แล้ว
  - run id เดิมกับไฟล์อื่นจะถูกปฏิเสธ
- **ทำซ้ำได้:** รันซ้ำหรือรัน run ใหม่บนข้อมูลเดิมไม่เปลี่ยนอะไร (เทส: ล้มกลางทางแล้ว resume, parity ผ่าน, รันอีกรอบก็ยังผ่าน)
- หลังโหลดเสร็จจะ `ANALYZE` ให้ planner ใช้ index

## 7. Parity

`npm run shadow -- parity <backup.json>` (`src/shadow/parity.ts`) exit code 1 เมื่อมี mismatch ใดๆ และบันทึกผลใน `parity_runs`

**สิ่งที่ตรวจ:**
- **Entity:** จำนวน, id หาย, id เกิน, เอกสารเปลี่ยน (เทียบ `doc` ทั้งก้อนแบบ stable JSON)
- **Child rows:** PO lines (ordered/received), transfer lines (dispatch/in-transit), receipt lines (qty)
- **Receipts:** เลขเอกสารจาก receive movements + PO receipts
- **ยอดคงเหลือต่อ product × location × unit สามแบบ:**
  - ledger (กติกาของ engine) เทียบ ledger (SQL view) ต้องตรง
  - stockLevels เทียบ stock_balances ต้องตรง
  - drift ภายใน Firestore เอง เป็นข้อมูลประกอบ (เป็นหน้าที่ของ integrity auditor)

**ไม่ปิดบังหรือ reconcile อัตโนมัติ:** รายงานทุก mismatch พร้อม id เช่น เทสที่แก้ qty ของ m2 ได้ผล `changed: m2` และ `br1__flour`, `wh__flour` mismatch

## 8. RLS (Firebase identity)

`migrations/0004_rls.sql`

**Identity:**
- Supabase third-party auth ยืนยัน Firebase ID token แล้ว `auth.jwt()->>'sub'` = Firebase uid ซึ่งจับคู่กับ `app_users`
- **ไม่ต้องสร้างบัญชีใหม่**
- ถ้าวันหนึ่ง browser อ่าน Supabase ต้องเพิ่ม custom claim `role: authenticated` ให้ผู้ใช้ทุกคนก่อน

**สิทธิ์ (ตรงกับ Firestore rules วันนี้):**
- active + ยังไม่ถูกถอนสิทธิ์: อ่านข้อมูลปฏิบัติการได้ทั้งสองแบรนด์
- `siteIds` ไม่จำกัดการอ่าน เพราะ Firestore ก็ไม่จำกัด เทสยืนยันว่า staff ที่มีสาขาเห็นทุกสาขา
- app_users: เห็นตัวเอง ส่วนแอดมินเห็นทุกคน
- notifications: เฉพาะผ่าน `notification_recipients` ของตัวเอง
- audit / outbox / checkpoints / parity: แอดมินเท่านั้น
- **ทุก role ฝั่ง client เขียนไม่ได้เลย รวมแอดมิน** (เทส: insert/update/delete ได้ permission denied)
- view ใช้ `security_invoker` ทำให้ RLS มีผลผ่าน view ด้วย

**เทสที่ผ่าน:** staff / manager / admin, inactive, uid ที่ไม่รู้จัก, anonymous, revoked, การเห็นข้ามสาขา, ผู้รับแจ้งเตือน, ห้ามเขียน

**Service role key อยู่ใน Worker secret เท่านั้น** ห้ามใส่ใน Pages หรือ `VITE_*`

## 9. Monitoring

view `shadow.replication_status` และ `npm run shadow -- status` แสดง:
- last_applied_at / last_event_occurred_at
- lag_seconds (event ที่ค้างนานที่สุด)
- applied / skipped_stale / pending / failed / **dead_letter** / retries
- last_parity_passed / last_parity_at
- ตาราง checkpoint ต่อ run × entity พร้อม `last_error`

แผนต่อไป: Worker เขียนสถานะนี้ลง `meta/shadowStatus` (1 write ต่อรอบ) ให้หน้า Settings › Automation แสดงข้างสถานะ cron

## Performance

benchmark บนข้อมูลจริงที่โหลดแล้ว หลัง ANALYZE เฉลี่ย 20 ครั้ง PGlite บนเครื่องนี้ (`npm run shadow -- bench`):

| Query | ms | ใช้ |
|---|---|---|
| open POs | 2.9 | seq scan (130 แถว เหมาะกว่า index) |
| supplier history 50 | 1.4 | seq scan (เล็ก) / index `purchase_orders_supplier` เมื่อข้อมูลโต |
| product stock ทุกสาขา | 1.1 | `stock_balances_pkey` |
| movement page 50 ล่าสุด | 1.7 | `stock_movements_date` |
| stock card สินค้าเดียว 50 | 1.5 | `stock_movements_product` |
| ยอดจาก ledger ทั้งแบรนด์ | 5.6 | aggregate |
| supplier metrics ล่าสุด | 0.9 | pkey |
| inventory risks (high) | 0.5 | pkey |
| notification inbox 30 | 0.8 | `notification_recipients_inbox` |

index สร้างเฉพาะตามรูปแบบการเข้าถึงจริง ไม่ทำ index ทุกคอลัมน์

## Phase G และ shadow predictions

- ตาราง `supplier_metrics`, `delivery_risks`, `inventory_risks` เก็บผลของ engine เดิม (`deliveryRisk` `rules-1`, `inventoryRisk`, `supplierScore`) พร้อม `engine_version`
- `prediction_snapshots` ครบตามที่ขอ:
  - engine_version, entity_type/id, calculated_at, inputs_as_of
  - score, risk_level, confidence, reasons
  - actual_outcome, evaluated_at
  - unique ต่อ (engine × entity × inputs_as_of) ทำให้รัน job ซ้ำไม่เกิดแถวซ้ำ
- **ข้อมูลดิบยังมาจาก Firestore** read model เหล่านี้เป็นข้อมูลที่ derive มาเท่านั้น

## Notifications

ออกแบบไว้แล้วแต่**ยังไม่ย้าย**:
- `notification_recipients` ต่อคน เก็บ read state ของแต่ละคน ทำให้การกดอ่านไม่กระทบคนอื่น
- realtime กรองด้วย `user_id = auth uid`
- เหตุผลที่ยังไม่ย้าย: แจ้งเตือนใน Firestore ตอนนี้เป็นแบบ recipient-scoped และอยู่ในงบแล้ว (resume ≈ 1 read)

## Shadow exit gate

| เกณฑ์ | ผล |
|---|---|
| migration reproducible | ✅ เทส + บันทึกการ apply |
| backfill resumable | ✅ เทสล้มกลางทาง → resume → parity ผ่าน |
| replication idempotent | ✅ ส่งซ้ำ / มาช้า / ลบ |
| ไม่มี direct client dual-write | ✅ ไม่มีโค้ด client เขียน Supabase; RLS ปฏิเสธการเขียนทุก role |
| parity checker ทำงาน | ✅ จับ mismatch ได้พร้อม id |
| เทียบยอดต่อ SKU × location ได้ | ✅ 481 + 36 combinations, 0 mismatches |
| replication failure มองเห็นได้ | ✅ dead_letter / retries / last_error |
| Firebase identity mapping ใช้ได้ | ✅ `sub` → app_users (เทส) |
| RLS tests ผ่าน | ✅ |
| read model ของ Phase G ใช้ได้อย่างปลอดภัย | ✅ ตาราง + RLS อ่านอย่างเดียว; เขียนโดย service role เท่านั้น |
| **ยังไม่ผ่าน** (ต้องให้เจ้าของทำ) | สร้าง Supabase project, third-party auth, wire outbox producer (ต้องแก้ rules) |

## สิ่งที่ phase นี้ไม่ได้ทำ (ตามข้อห้าม)

- ไม่เปลี่ยน source of truth
- ไม่ย้ายการเขียนสต๊อก / รับของ / โอน / post นับ
- ไม่ลบข้อมูล Firestore
- ไม่ปิด listener ใด
- ไม่ merge
- ไม่ deploy
