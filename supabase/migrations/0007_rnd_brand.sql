-- Migration 0007: the R&D brand (owner, main 4c74aaf, 8 Oct 2026: `rnd__*` collections).
--
-- 0001 limited every brand column to ('pizza', 'lelapin'); a third brand's rows would be
-- refused by the shadow. Each such check is replaced, table by table, with one that also
-- allows 'rnd'. Nothing else changes: keys stay (brand, id), RLS is untouched.
set search_path = shadow, public;

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
     where n.nspname = 'shadow' and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%brand%pizza%lelapin%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I check (brand in (''pizza'', ''lelapin'', ''rnd''))', r.tbl, r.conname);
  end loop;
end $$;
