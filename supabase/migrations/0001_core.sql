-- PZM Operations OS — Supabase shadow foundation (7 Oct 2026). Migration 0001: core tables.
--
-- Firestore stays the source of truth. These tables are a SHADOW, written only by the
-- service role (backfill and the outbox replicator, supabase/README.md). Nothing here is
-- written by a browser.
--
-- Identity: every row keeps its Firestore document id as `id`, keyed together with `brand`
-- (Pizza Mania `pizza` / Le Lapin `lelapin` — the same ids can exist in both, e.g. the
-- transit location). No new identity is invented for an existing record; child rows of an
-- array field (PO lines, transfer items) are keyed by their position in that array.
-- `doc` keeps the original document, so nothing the mapping does not model is lost and the
-- parity checker can always compare against the source.
-- Timestamps are Firestore epoch milliseconds converted to timestamptz; `business_date` is
-- the Bangkok calendar day of a business date.

create schema if not exists shadow;
set search_path = shadow, public;

create or replace function shadow.ms(v bigint) returns timestamptz
  language sql immutable as $$ select case when v is null then null else to_timestamp(v / 1000.0) end $$;

create or replace function shadow.bkk_day(v bigint) returns date
  language sql immutable as $$ select case when v is null then null else (to_timestamp(v / 1000.0) at time zone 'Asia/Bangkok')::date end $$;

-- ------------------------------------------------------------------ identity ----

-- Firebase Authentication stays the identity provider. `uid` is the Firebase uid, which is
-- also the `sub` of the Firebase ID token Supabase verifies (third-party auth).
create table app_users (
  uid          text primary key,
  name         text not null,
  email        text,
  role         text not null check (role in ('admin', 'manager', 'staff')),
  active       boolean not null default false,
  site_ids     text[] not null default '{}',
  revoked_at   timestamptz,
  created_at   timestamptz,
  replicated_at timestamptz not null default now(),
  doc          jsonb not null
);

-- --------------------------------------------------------------- master data ----

create table locations (
  brand        text not null check (brand in ('pizza', 'lelapin')),
  id           text not null,
  name         text not null,
  name_en      text,
  type         text not null check (type in ('warehouse', 'branch', 'transit')),
  active       boolean not null default true,
  created_at   timestamptz,
  deleted_at   timestamptz,
  version      bigint not null default 0,
  doc          jsonb not null,
  primary key (brand, id)
);

create table suppliers (
  brand          text not null check (brand in ('pizza', 'lelapin')),
  id             text not null,
  code           text,
  name           text not null,
  type           text,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  order_days     integer[],
  cutoff_time    text,
  active         boolean not null default true,
  created_at     timestamptz,
  updated_at     timestamptz,
  deleted_at     timestamptz,
  version        bigint not null default 0,
  doc            jsonb not null,
  primary key (brand, id)
);
create unique index suppliers_code on suppliers (brand, code) where code is not null and deleted_at is null;

create table products (
  brand        text not null check (brand in ('pizza', 'lelapin')),
  id           text not null,
  sku          text not null,
  barcode      text,
  name         text not null,
  category     text,
  unit_label   text,
  base_unit    text not null,
  min_stock    numeric not null default 0 check (min_stock >= 0),
  supplier_id  text,
  cost         numeric check (cost is null or cost >= 0),
  active       boolean not null default true,
  created_at   timestamptz,
  updated_at   timestamptz,
  deleted_at   timestamptz,
  version      bigint not null default 0,
  doc          jsonb not null,
  primary key (brand, id)
);
-- Not unique: the catalogue has carried duplicate SKUs while being cleaned up, and a shadow
-- must accept what the source holds (the parity report names them instead).
create index products_sku on products (brand, sku);

create table unit_conversions (
  brand        text not null,
  product_id   text not null,
  label        text not null,
  size         numeric not null check (size > 0),
  per          numeric check (per is null or per > 0),
  of_unit      text,
  primary key (brand, product_id, label),
  foreign key (brand, product_id) references products (brand, id) on delete cascade
);

create table supplier_products (
  brand          text not null,
  id             text not null,
  supplier_id    text not null,
  product_id     text not null,
  buying_price   numeric check (buying_price is null or buying_price >= 0),
  min_order_qty  numeric check (min_order_qty is null or min_order_qty >= 0),
  active         boolean not null default true,
  updated_at     timestamptz,
  version        bigint not null default 0,
  doc            jsonb not null,
  primary key (brand, id)
);

create table product_aliases (
  brand        text not null,
  id           text not null,
  key          text not null,
  source_name  text,
  product_id   text not null,
  created_by   text,
  created_at   timestamptz,
  doc          jsonb not null,
  primary key (brand, id)
);
create index product_aliases_key on product_aliases (brand, key);

-- ------------------------------------------------------------ purchasing ----

create table purchase_requests (
  brand          text not null,
  id             text not null,
  doc_no         text not null,
  status         text not null check (status in ('draft', 'pendingApproval', 'returned', 'approved', 'rejected', 'poCreated', 'skipped')),
  revision       integer not null default 0,
  location_id    text,
  requested_by   text,
  approved_by    text,
  approved_at    timestamptz,
  created_at     timestamptz,
  updated_at     timestamptz,
  version        bigint not null default 0,
  doc            jsonb not null,
  primary key (brand, id)
);
create index purchase_requests_status on purchase_requests (brand, status, created_at desc);

create table purchase_request_lines (
  brand          text not null,
  request_id     text not null,
  line_no        integer not null,
  product_id     text not null,
  supplier_id    text,
  unit           text,
  entry_unit     text,
  requested_qty  numeric check (requested_qty is null or requested_qty >= 0),
  approved_qty   numeric check (approved_qty is null or approved_qty >= 0),
  removed        boolean not null default false,
  primary key (brand, request_id, line_no),
  foreign key (brand, request_id) references purchase_requests (brand, id) on delete cascade
);

create table purchase_orders (
  brand          text not null,
  id             text not null,
  doc_no         text not null,
  supplier_id    text not null,
  supplier_name  text,
  status         text not null check (status in ('draft', 'ordered', 'received', 'cancelled')),
  location_id    text not null,
  request_id     text,
  ordered_at     timestamptz,
  expected_at    timestamptz,
  received_at    timestamptz,
  revision       integer not null default 0,
  created_by     text,
  created_at     timestamptz,
  updated_at     timestamptz,
  version        bigint not null default 0,
  doc            jsonb not null,
  primary key (brand, id)
);
-- Numbers run per supplier (`counters/purchaseOrder__<supplier>`), so a number is unique only with its supplier.
create index purchase_orders_open on purchase_orders (brand, status, expected_at) where status = 'ordered';
create index purchase_orders_supplier on purchase_orders (brand, supplier_id, ordered_at desc);

create table purchase_order_lines (
  brand          text not null,
  po_id          text not null,
  line_no        integer not null,
  product_id     text not null,
  unit           text not null,
  entry_unit     text,
  ordered_qty    numeric not null check (ordered_qty >= 0),
  base_qty       numeric check (base_qty is null or base_qty >= 0),
  received_qty   numeric not null default 0 check (received_qty >= 0),
  primary key (brand, po_id, line_no),
  foreign key (brand, po_id) references purchase_orders (brand, id) on delete cascade
);
create index purchase_order_lines_product on purchase_order_lines (brand, product_id);

-- ---------------------------------------------------------------- ledger ----

-- One row per stock document of type receive (a receipt), from the movements that share its
-- number; tied to its purchase order when one was received against.
create table receipts (
  brand          text not null,
  doc_no         text not null,
  receipt_id     text,                 -- rc_<po>_<operation>, receipts filed since 6 Oct 2026
  po_id          text,
  supplier_id    text,
  invoice_no     text,
  business_date  date,
  created_by     text,
  created_at     timestamptz,
  primary key (brand, doc_no)
);
create unique index receipts_receipt_id on receipts (brand, receipt_id) where receipt_id is not null;
create index receipts_po on receipts (brand, po_id) where po_id is not null;
create index receipts_bill on receipts (brand, supplier_id, lower(invoice_no)) where invoice_no is not null;

create table stock_movements (
  brand          text not null,
  id             text not null,
  doc_no         text not null,
  type           text not null check (type in ('receive', 'issue', 'adjust', 'consume')),
  product_id     text not null,
  unit           text not null,
  entry_unit     text,
  entry_qty      numeric check (entry_qty is null or entry_qty > 0),
  qty            numeric not null check (qty > 0),
  from_location  text,
  to_location    text,
  reason         text,
  po_id          text,
  transfer_id    text,
  invoice_no     text,
  business_date  date,
  occurred_ms    bigint not null,
  created_by     text,
  created_at     timestamptz,
  updated_at     timestamptz,
  voided         boolean not null default false,
  version        bigint not null default 0,
  doc            jsonb not null,
  primary key (brand, id),
  check (from_location is not null or to_location is not null)
);
create index stock_movements_product on stock_movements (brand, product_id, occurred_ms desc);
create index stock_movements_date on stock_movements (brand, occurred_ms desc);
create index stock_movements_doc on stock_movements (brand, doc_no);

create table receipt_lines (
  brand          text not null,
  doc_no         text not null,
  movement_id    text not null,
  product_id     text not null,
  qty_base       numeric not null check (qty_base > 0),
  qty_entry      numeric,
  entry_unit     text,
  primary key (brand, doc_no, movement_id),
  foreign key (brand, doc_no) references receipts (brand, doc_no) on delete cascade,
  foreign key (brand, movement_id) references stock_movements (brand, id) on delete cascade
);

-- Firestore's cached balances, as stored (stockLevels). `unit_key` is '' for the product's
-- own unit and the unit for a legacy per-unit balance (`#Pack`) — the same key the stock
-- engine files under (src/lib/levelKey.ts).
create table stock_balances (
  brand          text not null,
  location_id    text not null,
  product_id     text not null,
  unit_key       text not null default '',
  qty            numeric not null,
  updated_at     timestamptz,
  version        bigint not null default 0,
  primary key (brand, location_id, product_id, unit_key)
);

-- What the ledger in this database adds up to, by the engine's filing rule: a row keyed in
-- another unit WITHOUT entry_qty is a legacy row on its own unit's balance; every other row
-- is in the product's own unit. Voided rows count for nothing.
create view stock_balance_from_ledger as
with legs as (
  select brand, product_id, to_location as location_id,
         case when entry_unit is not null and entry_qty is null and btrim(entry_unit) <> btrim(unit) then btrim(entry_unit) else '' end as unit_key,
         qty
    from stock_movements where to_location is not null and not voided
  union all
  select brand, product_id, from_location,
         case when entry_unit is not null and entry_qty is null and btrim(entry_unit) <> btrim(unit) then btrim(entry_unit) else '' end,
         -qty
    from stock_movements where from_location is not null and not voided
)
select brand, location_id, product_id, unit_key, round(sum(qty), 3) as qty
  from legs group by brand, location_id, product_id, unit_key;

-- -------------------------------------------------------------- transfers ----

create table transfers (
  brand          text not null,
  id             text not null,
  doc_no         text not null,
  status         text not null,
  from_location  text not null,
  to_location    text not null,
  parent_id      text,
  dispatch_date  timestamptz,
  created_at     timestamptz,
  updated_at     timestamptz,
  version        bigint not null default 0,
  doc            jsonb not null,
  primary key (brand, id),
  check (from_location <> to_location)
);
create index transfers_open on transfers (brand, status) where status not in ('completed', 'cancelled', 'rejected');

create table transfer_lines (
  brand            text not null,
  transfer_id      text not null,
  line_no          integer not null,
  product_id       text not null,
  unit             text,
  requested_qty    numeric,
  dispatch_qty     numeric not null default 0 check (dispatch_qty >= 0),
  received_qty     numeric,
  in_transit_qty   numeric not null default 0 check (in_transit_qty >= 0),
  removed          boolean not null default false,
  primary key (brand, transfer_id, line_no),
  foreign key (brand, transfer_id) references transfers (brand, id) on delete cascade
);
