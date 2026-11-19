-- =====================================================================
-- PEAK VISION — one-time database setup for the admin dashboard
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- 1) Replace YOUR_EMAIL@example.com (bottom of the file) with the e-mail
--    that will log in to the dashboard.
-- 2) Safe to run again (e.g. to add another admin e-mail).
-- =====================================================================

-- Site content (one row, id = 'main')
create table if not exists public.site_content (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Automatic backups: the previous version is kept on every publish (last 50)
create table if not exists public.site_content_history (
  id         bigint generated always as identity primary key,
  content_id text not null,
  data       jsonb not null,
  saved_at   timestamptz not null default now(),
  saved_by   text
);

-- Who may edit the site
create table if not exists public.admin_emails (
  email text primary key
);

create or replace function public.is_site_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.site_content_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.site_content_history (content_id, data, saved_at, saved_by)
    values (old.id, old.data, old.updated_at, old.updated_by);
    delete from public.site_content_history
    where id in (select id from public.site_content_history
                 where content_id = old.id order by id desc offset 50);
  end if;
  new.updated_at := now();
  new.updated_by := auth.jwt() ->> 'email';
  return new;
end $$;

drop trigger if exists site_content_stamp on public.site_content;
create trigger site_content_stamp before insert or update on public.site_content
for each row execute function public.site_content_stamp();

-- Row level security: everyone can read the site, only admins can change it
alter table public.site_content         enable row level security;
alter table public.site_content_history enable row level security;
alter table public.admin_emails         enable row level security;

drop policy if exists "site_content public read"   on public.site_content;
drop policy if exists "site_content admin insert"  on public.site_content;
drop policy if exists "site_content admin update"  on public.site_content;
drop policy if exists "history admin read"         on public.site_content_history;
drop policy if exists "admin_emails admin read"    on public.admin_emails;

create policy "site_content public read"  on public.site_content for select using (true);
create policy "site_content admin insert" on public.site_content for insert to authenticated with check (public.is_site_admin());
create policy "site_content admin update" on public.site_content for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());
create policy "history admin read"        on public.site_content_history for select to authenticated using (public.is_site_admin());
create policy "admin_emails admin read"   on public.admin_emails for select to authenticated using (public.is_site_admin());

grant select on public.site_content to anon, authenticated;
grant insert, update on public.site_content to authenticated;
grant select on public.site_content_history to authenticated;
grant select on public.admin_emails to authenticated;
grant execute on function public.is_site_admin() to anon, authenticated;

-- Image storage (public bucket; only admins can upload / delete)
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do update set public = true;

drop policy if exists "site-images admin upload" on storage.objects;
drop policy if exists "site-images admin update" on storage.objects;
drop policy if exists "site-images admin delete" on storage.objects;
create policy "site-images admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-images' and public.is_site_admin());
create policy "site-images admin update" on storage.objects for update to authenticated
  using (bucket_id = 'site-images' and public.is_site_admin());
create policy "site-images admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-images' and public.is_site_admin());

-- ▼▼▼ The e-mail(s) allowed to use the dashboard ▼▼▼
insert into public.admin_emails (email) values ('YOUR_EMAIL@example.com')
on conflict (email) do nothing;
