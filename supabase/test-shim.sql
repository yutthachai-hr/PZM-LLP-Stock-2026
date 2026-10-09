-- What a Supabase database already provides, recreated for the local PostgreSQL the tests
-- and the shadow CLI run on (PGlite). NOT a migration — never applied to Supabase itself.
--
-- Supabase's auth.jwt() reads the request's verified claims from the setting
-- `request.jwt.claims`; the tests set it per person exactly the same way.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb
  language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
