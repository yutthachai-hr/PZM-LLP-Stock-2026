-- Migration 0006: pin browser tokens to OUR Firebase project (P1 Supabase hybrid, 8 Oct 2026).
--
-- Firebase signs every project's ID tokens with the same Google keys, so a token from an
-- unrelated Firebase project is a validly signed JWT. Hosted Supabase already rejects tokens
-- from Firebase projects that are not registered (Supabase docs, "Third-party auth →
-- Firebase Auth"); this is the restrictive policy those docs recommend, kept here as
-- defence in depth so the shadow's safety does not rest on a dashboard setting alone.
--
-- The project is data, not code: one row in shadow.auth_settings, written by the service
-- role when the project is set up (production: pzm-stock-x5; a staging Supabase: the staging
-- Firebase project). No row = no browser reads at all (fails closed). Restrictive policies
-- only ever narrow what 0004 grants; the service role bypasses RLS as before.
set search_path = shadow, public;

create table if not exists shadow.auth_settings (
  only_row boolean primary key default true check (only_row),
  firebase_project_id text not null check (firebase_project_id ~ '^[a-z0-9-]{4,40}$')
);
alter table shadow.auth_settings enable row level security; -- no policy: browsers read nothing here
revoke all on shadow.auth_settings from anon, authenticated;

create or replace function shadow.token_is_ours() returns boolean
  language sql stable security definer set search_path = shadow, public as $$
  select exists (
    select 1 from shadow.auth_settings s
     where auth.jwt() ->> 'iss' = 'https://securetoken.google.com/' || s.firebase_project_id
       and auth.jwt() ->> 'aud' = s.firebase_project_id)
$$;
grant execute on function shadow.token_is_ours() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'locations', 'suppliers', 'products', 'unit_conversions', 'supplier_products', 'product_aliases',
    'purchase_requests', 'purchase_request_lines', 'purchase_orders', 'purchase_order_lines',
    'receipts', 'receipt_lines', 'stock_movements', 'stock_balances', 'transfers', 'transfer_lines',
    'supplier_metrics', 'delivery_risks', 'inventory_risks', 'prediction_snapshots',
    'audit_log', 'outbox_events', 'migration_checkpoints', 'parity_runs',
    'app_users', 'notifications', 'notification_recipients'
  ] loop
    execute format('create policy %I on shadow.%I as restrictive for select to authenticated using ((select shadow.token_is_ours()))', t || '_our_project', t);
  end loop;
end $$;
