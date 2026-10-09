-- Migration 0008: cold-start seed pilot (P1, 8 Oct 2026). Firestore stays authoritative.
--
-- A device with no copy of a collection may take it from the shadow INSTEAD of a full
-- Firestore read, then follow Firestore's changes from the shadow's watermark — but only
-- when the shadow can prove it is complete up to that watermark:
--
--   complete_through  every document stamped before it is applied here (the Worker's scan
--                     cursor less its clock margin); written by the Worker after each run
--   unresolved        events for that brand + collection still pending, failed or dead:
--                     anything above 0 and the seed is refused
--   synced_at         when the Worker last proved it; a stale proof is refused by the client
--
-- The browser reads none of these tables directly: shadow.seed_status() answers for the
-- caller's brand and collection, and only to an active, unrevoked person holding OUR
-- project's token (0004, 0006). The rows themselves are read through the existing RLS.
set search_path = shadow, public;

create table if not exists shadow.sync_watermarks (
  brand             text not null check (brand in ('pizza', 'lelapin', 'rnd')),
  entity            text not null,
  complete_through  bigint not null check (complete_through >= 0),
  unresolved        integer not null default 0 check (unresolved >= 0),
  synced_at         timestamptz not null default now(),
  primary key (brand, entity)
);
alter table shadow.sync_watermarks enable row level security;
revoke all on shadow.sync_watermarks from anon, authenticated;
-- Admins see them as operators; the restrictive project pin of 0006 applies here too.
create policy sync_watermarks_admin on shadow.sync_watermarks for select to authenticated using (shadow.is_admin());
create policy sync_watermarks_our_project on shadow.sync_watermarks as restrictive for select to authenticated using ((select shadow.token_is_ours()));
grant select on shadow.sync_watermarks to authenticated;

-- What a device needs to decide whether it may seed `p_entity` of `p_brand` from here.
-- Null for anyone who may not read operational data (inactive, revoked, foreign token).
create or replace function shadow.seed_status(p_brand text, p_entity text) returns jsonb
  language sql stable security definer set search_path = shadow, public as $$
  select case when shadow.is_active() and shadow.token_is_ours() then (
    select jsonb_build_object(
      'completeThrough', w.complete_through,
      'unresolved', w.unresolved,
      'syncedAt', (extract(epoch from w.synced_at) * 1000)::bigint,
      'parityPassedAt', (select (extract(epoch from max(p.ran_at)) * 1000)::bigint from shadow.parity_runs p where p.passed
                          and p.ran_at > coalesce((select max(f.ran_at) from shadow.parity_runs f where not f.passed), '-infinity'::timestamptz)),
      'rows', case p_entity
                when 'products' then (select count(*) from shadow.products x where x.brand = p_brand and x.deleted_at is null)
                when 'stockLevels' then (select count(*) from shadow.stock_balances x where x.brand = p_brand)
              end)
      from shadow.sync_watermarks w
     where w.brand = p_brand and w.entity = p_entity)
  end
$$;
revoke all on function shadow.seed_status(text, text) from public;
grant execute on function shadow.seed_status(text, text) to authenticated;
