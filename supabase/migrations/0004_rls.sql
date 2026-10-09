-- Migration 0004: row-level security.
--
-- Identity is Firebase's. Supabase verifies the Firebase ID token (third-party auth) and
-- exposes its claims as auth.jwt(); `sub` is the Firebase uid, looked up in app_users —
-- the replicated copy of Firestore `users/{uid}` (role, active, site_ids, revoked). Nobody
-- makes a new account.
--
-- In this shadow phase the browser may READ, and only what Firestore lets it read today:
--   - an active, unrevoked person reads both brands' operational data (Firestore rules
--     `active() && brandData(...)` — site assignment does not narrow reads there either,
--     and the shadow does not quietly change who sees what);
--   - a person reads their own app_users row; an admin reads all;
--   - notifications only through a recipient row naming the reader;
--   - the audit log, the outbox, checkpoints and parity runs: admins only.
-- The browser WRITES NOTHING: no insert/update/delete grant, no write policy. Every write is
-- the service role's (backfill, replicator), which Supabase exempts from RLS and never ships
-- to a browser.
set search_path = shadow, public;

create or replace function shadow.me_uid() returns text
  language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '') $$;

-- security definer: reads app_users past its own RLS, for the checks below only.
create or replace function shadow.my_role() returns text
  language sql stable security definer set search_path = shadow, public as $$
  select role from shadow.app_users
   where uid = shadow.me_uid() and active and revoked_at is null
$$;

create or replace function shadow.is_active() returns boolean
  language sql stable as $$ select shadow.my_role() is not null $$;

create or replace function shadow.is_admin() returns boolean
  language sql stable as $$ select shadow.my_role() = 'admin' $$;

grant usage on schema shadow to authenticated;
revoke all on all tables in schema shadow from anon, authenticated;
grant select on all tables in schema shadow to authenticated;
grant execute on function shadow.me_uid(), shadow.my_role(), shadow.is_active(), shadow.is_admin(), shadow.ms(bigint), shadow.bkk_day(bigint) to authenticated;

-- Views read with the caller's rights, so RLS applies through them.
alter view stock_balance_from_ledger set (security_invoker = true);
alter view replication_status set (security_invoker = true);

do $$
declare t text;
begin
  -- Operational data: any active person, both brands (as Firestore).
  foreach t in array array[
    'locations', 'suppliers', 'products', 'unit_conversions', 'supplier_products', 'product_aliases',
    'purchase_requests', 'purchase_request_lines', 'purchase_orders', 'purchase_order_lines',
    'receipts', 'receipt_lines', 'stock_movements', 'stock_balances', 'transfers', 'transfer_lines',
    'supplier_metrics', 'delivery_risks', 'inventory_risks', 'prediction_snapshots'
  ] loop
    execute format('alter table shadow.%I enable row level security', t);
    execute format('create policy %I on shadow.%I for select to authenticated using (shadow.is_active())', t || '_read', t);
  end loop;
  -- Admin-only records.
  foreach t in array array['audit_log', 'outbox_events', 'migration_checkpoints', 'parity_runs'] loop
    execute format('alter table shadow.%I enable row level security', t);
    execute format('create policy %I on shadow.%I for select to authenticated using (shadow.is_admin())', t || '_admin', t);
  end loop;
end $$;

alter table app_users enable row level security;
create policy app_users_self_or_admin on app_users for select to authenticated
  using (uid = shadow.me_uid() or shadow.is_admin());

alter table notification_recipients enable row level security;
create policy notification_recipients_mine on notification_recipients for select to authenticated
  using (user_id = shadow.me_uid() and shadow.is_active());

alter table notifications enable row level security;
create policy notifications_mine on notifications for select to authenticated
  using (shadow.is_active() and exists (
    select 1 from shadow.notification_recipients r
     where r.brand = notifications.brand and r.notification_id = notifications.id and r.user_id = shadow.me_uid()));
