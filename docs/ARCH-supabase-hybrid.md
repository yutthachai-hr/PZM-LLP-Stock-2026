# Supabase: Hybrid Stage และแผนย้ายระยะยาว (ศึกษาเท่านั้น ยังไม่ทำ)

สถานะ: **ข้อเสนอ** · ห้าม migrate production · ห้าม dual-write จาก client
ลำดับที่ต้องเป็นจริงก่อนเริ่ม:
1. Firestore ถูกต้องก่อน (Phase A / A-rules / A-sec ตาม `docs/PLAN-operations-os.md`)
2. Firestore อยู่ใต้โควตาอย่างมั่นคงแล้ว (`docs/evidence/read-budget.md`)

Supabase เข้ามาเพื่อ **read model และ realtime** ไม่ใช่เพื่อหนีปัญหาความถูกต้อง

## 8. Hybrid Stage 1 (Firestore ยังเป็น source of truth)

```
Client ──(เขียนครั้งเดียว)──▶ Firestore  [source of truth]
                              │
                              ▼  outbox/{eventId}  (เขียนใน transaction เดียวกับธุรกรรม)
                     Cloudflare Worker "replicator" (cron 1 นาที / หรือ trigger)
                              │  อ่าน outbox ตามลำดับ, idempotent upsert ด้วย eventId
                              ▼
                         Supabase Postgres  [read models]
                         ├─ notification_inbox (+ Realtime ต่อผู้ใช้)
                         ├─ supplier_metrics / delivery_risk
                         ├─ inventory_risks / daily_summary
                         └─ analytics aggregates
Client ◀── อ่าน read model / Realtime (RLS ด้วย Firebase JWT ผ่าน Supabase third-party auth)
```

**กติกา:**
- **ห้าม client เขียนสองฐาน** ธุรกรรมธุรกิจ commit ที่ Firestore ที่เดียว
  - outbox event `{ id, aggregate, aggregateId, type, payload, at, version }` เขียนใน **transaction เดียวกัน** ทำให้ได้ทั้งสองอย่างหรือไม่ได้เลย
  - เส้นทาง receive แบบ idempotent ของ A1 คือที่แรกที่ควรเพิ่ม event
- **Replicator:**
  - อ่าน outbox ตาม `at`, upsert ด้วย `event_id` เป็น unique key (กันซ้ำ)
  - เก็บ watermark, ทำเครื่องหมาย `replicatedAt`
  - ลบ outbox ที่ replicate แล้วเกิน 7 วัน
- **Auth:** Firebase Auth อยู่ต่อ ส่วน Supabase ใช้ JWT ของ Firebase (third-party auth) โดย RLS อ่าน `auth.jwt()->>'sub'` และ role จากตาราง `app_users`
- **ประโยชน์ทันที:**
  - inbox แจ้งเตือนผ่าน Postgres + Realtime (ไม่มีโควตาอ่านต่อเอกสาร)
  - supplier metrics / risk คำนวณครั้งเดียวที่ server แทนการคำนวณทุกเครื่อง
- **ต้นทุน:** Supabase Free (500 MB DB, 2 GB egress, Realtime 200 concurrent) พอสำหรับ 2 แบรนด์ แต่ต้องเฝ้า egress

## 9. สถาปัตยกรรมเป้าหมาย (Postgres)

ทุกตารางมี `brand text not null check (brand in ('pizza','lelapin'))` และ RLS ตาม brand + role

```sql
create table products (id text primary key, brand text not null, sku text not null, name text not null,
  base_unit text not null, category text, active boolean not null default true,
  updated_at timestamptz not null default now(), unique (brand, sku));
create table unit_conversions (product_id text references products, label text, factor numeric not null check (factor > 0),
  primary key (product_id, label));
create table locations (id text primary key, brand text not null, name text not null,
  type text not null check (type in ('warehouse','branch','transit')), active boolean not null default true);
create table suppliers (id text primary key, brand text not null, code text, name text not null, lead_time_days int,
  active boolean not null default true, unique (brand, code));

create table purchase_requests (id text primary key, brand text not null, doc_no text not null,
  status text not null check (status in ('draft','pendingApproval','returned','approved','rejected','poCreated','skipped')),
  location_id text references locations, requested_by text not null, approved_by text, converted_at timestamptz,
  conversion_run_id text unique, unique (brand, doc_no));
create table purchase_orders (id text primary key, brand text not null, supplier_id text not null references suppliers,
  doc_no text not null, status text not null check (status in ('draft','ordered','received','cancelled')),
  location_id text not null references locations, request_id text references purchase_requests,
  expected_at date, ordered_at timestamptz not null, revision int not null default 0,
  unique (brand, supplier_id, doc_no), unique (request_id, supplier_id));      -- A6: หนึ่ง PO ต่อ PR×ผู้ขาย
create table purchase_order_lines (po_id text references purchase_orders, line_no int, product_id text references products,
  entry_unit text, ordered_qty numeric not null check (ordered_qty > 0), base_qty numeric not null check (base_qty > 0),
  received_qty numeric not null default 0 check (received_qty >= 0), primary key (po_id, line_no));

create table receipts (id text primary key, brand text not null, po_id text references purchase_orders,
  operation_id text not null, doc_no text not null, invoice_no text, supplier_id text references suppliers,
  received_at date not null, by_user text not null, unique (po_id, operation_id),          -- A1 idempotency
  unique (brand, doc_no));
create unique index receipts_dup_bill on receipts (brand, supplier_id, lower(invoice_no)) where invoice_no is not null;
create table receipt_lines (receipt_id text references receipts, product_id text references products,
  qty_entry numeric not null check (qty_entry > 0), qty_base numeric not null check (qty_base > 0),
  rejected_qty numeric not null default 0 check (rejected_qty >= 0), reason text, primary key (receipt_id, product_id));

create table stock_movements (id text primary key, brand text not null, doc_no text not null,
  type text not null check (type in ('receive','issue','adjust','consume')),
  product_id text not null references products, from_location text references locations, to_location text references locations,
  qty numeric not null check (qty > 0), entry_unit text, entry_qty numeric, reason text,
  receipt_id text references receipts, transfer_id text references transfers, business_date date not null,
  created_at timestamptz not null default now(), created_by text not null, voided_at timestamptz, void_reason text,
  check (from_location is not null or to_location is not null),
  check (voided_at is null or void_reason is not null));
create table stock_balances (brand text, location_id text references locations, product_id text references products,
  qty numeric not null check (qty >= 0), primary key (brand, location_id, product_id));   -- เขียนโดย trigger/RPC เท่านั้น

create table transfers (id text primary key, brand text not null, doc_no text not null, status text not null,
  from_location text not null references locations, to_location text not null references locations,
  check (from_location <> to_location), unique (brand, doc_no));
create table transfer_lines (transfer_id text references transfers, line_no int, product_id text references products,
  dispatch_qty numeric not null check (dispatch_qty >= 0), received_qty numeric, in_transit_qty numeric not null default 0
  check (in_transit_qty >= 0), primary key (transfer_id, line_no));

create table notifications (id text primary key, brand text not null, kind text not null, priority text not null,
  params jsonb not null, link text, active boolean not null, created_at timestamptz not null, expires_at timestamptz not null);
create table notification_recipients (notification_id text references notifications on delete cascade,
  user_id text not null, read_at timestamptz, primary key (notification_id, user_id));     -- read state ต่อคน
create table audit_log (id bigserial primary key, brand text not null, at timestamptz not null default now(),
  actor text not null, action text not null, entity text not null, entity_id text not null,
  before jsonb, after jsonb, reason text);
create table product_aliases (brand text, alias text, product_id text references products, primary key (brand, alias));
create table supplier_metrics (brand text, supplier_id text references suppliers, as_of date,
  on_time_rate numeric, fill_rate numeric, score numeric, primary key (brand, supplier_id, as_of));
create table inventory_risks (brand text, product_id text, location_id text, as_of timestamptz,
  kind text, level text, detail jsonb, primary key (brand, product_id, location_id, kind));
```

**Transactions:**
- ทุกคำสั่งสต๊อกเป็น RPC (`security definer`) ใน transaction เดียว: ตรวจ role → เขียน movement → อัปเดต balance (`check qty >= 0`) → เขียน `audit_log` → เขียน outbox
- client ไม่มีสิทธิ์ `insert`/`update` บน `stock_movements`/`stock_balances` เลย (RLS) ตรงกับ ADR-001

## Shadow Migration

1. แก้ความถูกต้องของ Firestore ให้เสร็จ (Phase A–A-sec)
2. **Backfill:** script อ่าน backup JSON (เหมือน `npm run audit:integrity`) แล้ว `copy` เข้า Postgres; stock_balances คำนวณจาก movements แล้วเทียบกับ Firestore stockLevels
3. Firestore ยังเป็น source of truth และ outbox → replicator ทำงานต่อเนื่อง
4. **Shadow reads:** หน้าจอ read-only บางหน้า (supplier performance, รายงาน) อ่านทั้งสองฝั่งใน dev แล้ว log ความต่าง
5. **Parity รายวัน** (Worker): ใช้ Integrity Auditor ตัวเดียวกันรันบนทั้งสองฝั่ง แล้วเทียบ:
   - จำนวน products / POs / receipts / movements
   - balance ต่อ SKU × location (ต้องตรง 100%)
   - transit balance ต่อ transfer
   - supplier metrics (ต่างได้ไม่เกิน 0.1%)
6. **ห้าม cutover** จนกว่า parity ผ่านติดกัน 30 วัน และเจ้าของอนุมัติ

## 10. ขั้น cutover ถัดไปที่แนะนำ

**ขั้นแรก: notification inbox → Supabase Realtime** (หลัง Phase A-sec)
- **เหตุผล:**
  - เป็น read model ล้วน ไม่มีผลต่อยอดสต๊อก
  - ได้ประโยชน์ด้านโควตามากที่สุดในส่วนที่เหลือ: read state ต่อคน, broadcast
  - ถอยกลับง่าย เพราะ Firestore ยังเขียน notifications อยู่ตามเดิม
- ก่อนถึงตรงนั้น ทางที่ให้ผลคุ้มกว่า (ไม่ต้องย้ายฐาน) คือข้อ 6.1–6.2 ใน `docs/evidence/read-budget.md`
