-- Migration 0002: notifications (design for a later move — no cutover), audit log, and the
-- Phase G intelligence read models (derived data; raw truth still comes from Firestore).
set search_path = shadow, public;

create table notifications (
  brand        text not null,
  id           text not null,           -- the Firestore dedup id `<kind>__<subject>`
  kind         text not null,
  category     text not null,
  priority     text not null check (priority in ('critical', 'high', 'medium', 'info')),
  params       jsonb not null default '{}',
  link         text,
  active       boolean not null default true,
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  expires_at   timestamptz not null,
  doc          jsonb not null,
  primary key (brand, id)
);

-- One row per person a notification reaches, so read state belongs to the reader (a read
-- mark no longer rewrites a document every other recipient listens to) and a realtime
-- subscription can filter on `user_id = auth uid`.
create table notification_recipients (
  brand            text not null,
  notification_id  text not null,
  user_id          text not null,
  read_at          timestamptz,
  primary key (brand, notification_id, user_id),
  foreign key (brand, notification_id) references notifications (brand, id) on delete cascade
);
create index notification_recipients_inbox on notification_recipients (user_id, brand, notification_id);

-- Append-only record of who changed what (plan B2). Written by the service role only.
create table audit_log (
  id           bigint generated always as identity primary key,
  brand        text not null,
  at           timestamptz not null default now(),
  actor        text not null,
  action       text not null,
  entity_type  text not null,
  entity_id    text not null,
  before       jsonb,
  after        jsonb,
  reason       text,
  event_id     uuid unique                -- the outbox event it came from, when it did
);
create index audit_log_entity on audit_log (brand, entity_type, entity_id, at desc);

-- ------------------------------------------------------- Phase G read models ----

create table supplier_metrics (
  brand            text not null,
  supplier_id      text not null,
  as_of            date not null,
  window_days      integer not null check (window_days > 0),
  orders           integer not null default 0,
  on_time_rate     numeric check (on_time_rate between 0 and 1),
  fill_rate        numeric check (fill_rate between 0 and 1),
  score            numeric,
  grade            text,
  engine_version   text not null,
  computed_at      timestamptz not null default now(),
  primary key (brand, supplier_id, as_of, window_days)
);

create table delivery_risks (
  brand            text not null,
  po_id            text not null,
  as_of            timestamptz not null,
  score            numeric not null check (score between 0 and 100),
  level            text not null,
  reasons          jsonb not null default '[]',
  engine_version   text not null,
  primary key (brand, po_id, as_of)
);

create table inventory_risks (
  brand            text not null,
  product_id       text not null,
  location_id      text not null,
  kind             text not null,
  as_of            timestamptz not null,
  level            text not null,
  detail           jsonb not null default '{}',
  engine_version   text not null,
  primary key (brand, product_id, location_id, kind, as_of)
);

-- Shadow predictions with their later outcome — the evaluation dataset for Phase G.
create table prediction_snapshots (
  id               uuid primary key default gen_random_uuid(),
  brand            text not null,
  engine_version   text not null,
  entity_type      text not null,
  entity_id        text not null,
  calculated_at    timestamptz not null,
  inputs_as_of     timestamptz not null,
  score            numeric,
  risk_level       text,
  confidence       numeric check (confidence is null or confidence between 0 and 1),
  reasons          jsonb not null default '[]',
  actual_outcome   jsonb,
  evaluated_at     timestamptz,
  -- one prediction per engine, entity and input moment: re-running a job does not duplicate
  unique (brand, engine_version, entity_type, entity_id, inputs_as_of)
);
create index prediction_snapshots_unevaluated on prediction_snapshots (brand, entity_type, calculated_at) where evaluated_at is null;
