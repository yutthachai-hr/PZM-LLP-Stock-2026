-- Migration 0003: the replication log and migration checkpoints.
--
-- Producer (designed, not yet wired into production): every business transaction in
-- Firestore also writes `outbox/{eventId}` in the SAME transaction — so an event exists if
-- and only if the change committed. The replicator (src/shadow/replicate.ts, run by the
-- cron Worker with the service role) copies events here and applies them. The client never
-- writes to Supabase, and never writes two databases.
set search_path = shadow, public;

create table outbox_events (
  event_id            uuid primary key,          -- the Firestore outbox doc id; the idempotency key
  brand               text not null,
  event_type          text not null,             -- e.g. purchaseOrder.received, movement.filed
  entity_type         text not null,             -- products, purchaseOrders, stockMovements …
  entity_id           text not null,
  entity_version      bigint,                    -- the document's updatedAt (ms) when it has one
  occurred_at         timestamptz not null,
  created_at          timestamptz not null default now(),
  schema_version      integer not null default 1,
  payload             jsonb not null,            -- the document as committed (or {deleted:true})
  replication_status  text not null default 'pending'
                      check (replication_status in ('pending', 'applied', 'skipped_stale', 'failed', 'dead')),
  attempt_count       integer not null default 0 check (attempt_count >= 0),
  last_error          text,
  applied_at          timestamptz
);
create index outbox_events_pending on outbox_events (occurred_at) where replication_status in ('pending', 'failed');
create index outbox_events_entity on outbox_events (brand, entity_type, entity_id, occurred_at desc);

-- Resumable backfills: one row per run × entity, advanced after every committed chunk.
create table migration_checkpoints (
  run_id        text not null,
  entity        text not null,
  source        text not null,                -- e.g. backup file name + its createdAt
  total         integer not null default 0,
  done          integer not null default 0 check (done >= 0),
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  last_error    text,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (run_id, entity)
);

-- Parity results, kept so a run can be compared with the last.
create table parity_runs (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  source      text not null,
  passed      boolean not null,
  summary     jsonb not null
);

-- What an operator looks at: is replication keeping up, and is anything stuck.
create view replication_status as
select
  (select max(applied_at) from outbox_events where replication_status = 'applied')                       as last_applied_at,
  (select max(occurred_at) from outbox_events where replication_status = 'applied')                      as last_event_occurred_at,
  (select extract(epoch from (now() - min(occurred_at))) from outbox_events
     where replication_status in ('pending', 'failed'))                                                  as lag_seconds,
  (select count(*) from outbox_events where replication_status = 'applied')                              as applied,
  (select count(*) from outbox_events where replication_status = 'skipped_stale')                        as skipped_stale,
  (select count(*) from outbox_events where replication_status = 'pending')                              as pending,
  (select count(*) from outbox_events where replication_status = 'failed')                               as failed,
  (select count(*) from outbox_events where replication_status = 'dead')                                 as dead_letter,
  (select coalesce(sum(greatest(attempt_count - 1, 0)), 0) from outbox_events)                           as retries,
  (select passed from parity_runs order by ran_at desc limit 1)                                          as last_parity_passed,
  (select ran_at from parity_runs order by ran_at desc limit 1)                                          as last_parity_at;
