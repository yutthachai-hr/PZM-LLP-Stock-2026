-- Migration 0005 (G18, 7 Oct 2026): correlation ids on replicated events.
--
-- A stock command's outbox event carries the workflow (trace_id), the API request
-- (request_id) and the business operation (operation_id) it came from, so one receipt can be
-- followed from the app's tap to the shadow row. Ids only: no payload is added.
set search_path = shadow, public;

alter table outbox_events add column if not exists trace_id text check (trace_id is null or trace_id ~ '^[0-9a-f]{32}$');
alter table outbox_events add column if not exists request_id text check (request_id is null or request_id ~ '^[0-9a-f]{16}$');
alter table outbox_events add column if not exists operation_id text check (operation_id is null or length(operation_id) between 6 and 64);
create index if not exists outbox_events_trace on outbox_events (trace_id) where trace_id is not null;
