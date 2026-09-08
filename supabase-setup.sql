-- Surfboard Color Studio v2.0 cloud backend
-- Run in Supabase Dashboard -> SQL Editor.
--
-- IMPORTANT FOR EXISTING INSTALLATIONS:
-- 1) Create the owner's email/password user in Supabase Authentication -> Users FIRST.
-- 2) Then run this file.
-- If there is exactly one Auth user, all existing projects with no owner_id are
-- automatically assigned to that user (so old projects such as top/top 2/top 3 appear).
--
-- Sharing model:
-- - Signed-in owner: can list/open/save/delete all projects where owner_id = auth.uid().
-- - Anyone with a project edit link: can open/save ONLY that project via its secret token.
-- - There is no view/color-only link in v2.0.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.surfboard_projects (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  edit_token_hash text not null,
  edit_token_secret text,
  image_data text not null,
  project_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration from v1.x.
alter table public.surfboard_projects add column if not exists owner_id uuid;
alter table public.surfboard_projects add column if not exists edit_token_secret text;

-- Ensure owner_id has an FK even if the column came from an older/partial migration.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'surfboard_projects_owner_id_fkey'
      and conrelid = 'public.surfboard_projects'::regclass
  ) then
    alter table public.surfboard_projects
      add constraint surfboard_projects_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- Remove v1.x view-only functions before removing the old view token column.
drop function if exists public.create_surfboard_project(text,text,text,jsonb);
drop function if exists public.get_surfboard_project(uuid,text);
drop function if exists public.delete_surfboard_project(uuid,text);

alter table public.surfboard_projects drop column if exists view_token_hash;

create index if not exists surfboard_projects_owner_updated_idx
  on public.surfboard_projects(owner_id, updated_at desc);

alter table public.surfboard_projects enable row level security;

-- No browser role reads the table directly. Every operation goes through a narrowly
-- scoped RPC below. Owner RPCs check auth.uid(); shared RPCs check the edit token hash.
revoke all on table public.surfboard_projects from anon, authenticated;

-- If this project currently has exactly one Supabase Auth user, adopt all legacy rows.
-- This is intentionally automatic only in the unambiguous single-user case.
do $$
declare
  user_count integer;
  sole_user_id uuid;
begin
  select count(*) into user_count from auth.users;
  if user_count = 1 then
    select id into sole_user_id from auth.users limit 1;
    update public.surfboard_projects
       set owner_id = sole_user_id
     where owner_id is null;
  end if;
end $$;

-- Create a new owned project. Only authenticated users may call this.
create or replace function public.create_surfboard_project(
  p_edit_token text,
  p_image_data text,
  p_project_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication required';
  end if;
  if length(coalesce(p_edit_token, '')) < 20 then
    raise exception 'invalid token';
  end if;
  if length(coalesce(p_image_data, '')) < 32 then
    raise exception 'invalid image';
  end if;

  insert into public.surfboard_projects (
    owner_id,
    edit_token_hash,
    edit_token_secret,
    image_data,
    project_data
  ) values (
    caller_id,
    encode(extensions.digest(p_edit_token, 'sha256'), 'hex'),
    p_edit_token,
    p_image_data,
    coalesce(p_project_data, '{}'::jsonb)
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- Owner: compact list for "My Projects" (does not return image/masks).
create or replace function public.list_owned_surfboard_projects()
returns table (
  id uuid,
  name text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    p.id,
    coalesce(nullif(p.project_data ->> 'name', ''), 'פרויקט גלשן')::text as name,
    p.created_at,
    p.updated_at
  from public.surfboard_projects p
  where auth.uid() is not null
    and p.owner_id = auth.uid()
  order by p.updated_at desc;
$$;

-- Owner: load one project without needing the share token.
create or replace function public.get_owned_surfboard_project(p_id uuid)
returns table (
  id uuid,
  image_data text,
  project_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.image_data, p.project_data, p.created_at, p.updated_at
  from public.surfboard_projects p
  where auth.uid() is not null
    and p.owner_id = auth.uid()
    and p.id = p_id
  limit 1;
$$;

-- Owner: save one owned project.
create or replace function public.save_owned_surfboard_project(
  p_id uuid,
  p_project_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.surfboard_projects
     set project_data = coalesce(p_project_data, '{}'::jsonb),
         updated_at = now()
   where id = p_id
     and auth.uid() is not null
     and owner_id = auth.uid();

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- Owner: permanently delete one owned project.
create or replace function public.delete_owned_surfboard_project(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  delete from public.surfboard_projects
   where id = p_id
     and auth.uid() is not null
     and owner_id = auth.uid();

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- Owner: return a stable edit token. Legacy projects have only a hash, so on the
-- first call after migration a new token is generated and becomes the stable link.
create or replace function public.get_owned_surfboard_edit_token(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_value text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select p.edit_token_secret
    into token_value
    from public.surfboard_projects p
   where p.id = p_id
     and p.owner_id = auth.uid();

  if not found then
    raise exception 'project not found or not owned';
  end if;

  if token_value is null or length(token_value) < 20 then
    token_value := encode(extensions.gen_random_bytes(32), 'hex');
    update public.surfboard_projects
       set edit_token_secret = token_value,
           edit_token_hash = encode(extensions.digest(token_value, 'sha256'), 'hex'),
           updated_at = now()
     where id = p_id
       and owner_id = auth.uid();
  end if;

  return token_value;
end;
$$;

-- Owner migration helper: if this browser still knows an old v1.x edit token and
-- it matches the stored hash, preserve that token as the stable cross-device link.
create or replace function public.adopt_owned_surfboard_edit_token(
  p_id uuid,
  p_edit_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if auth.uid() is null or length(coalesce(p_edit_token, '')) < 20 then
    return false;
  end if;

  update public.surfboard_projects
     set edit_token_secret = p_edit_token
   where id = p_id
     and owner_id = auth.uid()
     and edit_token_hash = encode(extensions.digest(p_edit_token, 'sha256'), 'hex')
     and (edit_token_secret is null or edit_token_secret = p_edit_token);

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- Shared edit link: load exactly one project when its edit token is correct.
create or replace function public.get_surfboard_project(
  p_id uuid,
  p_token text
)
returns table (
  id uuid,
  image_data text,
  project_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  access_level text
)
language sql
security definer
set search_path = ''
as $$
  select
    p.id,
    p.image_data,
    p.project_data,
    p.created_at,
    p.updated_at,
    'edit'::text as access_level
  from public.surfboard_projects p
  where p.id = p_id
    and p.edit_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  limit 1;
$$;

-- Shared edit link: save exactly one project when its edit token is correct.
create or replace function public.save_surfboard_project(
  p_id uuid,
  p_edit_token text,
  p_project_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.surfboard_projects
     set project_data = coalesce(p_project_data, '{}'::jsonb),
         updated_at = now()
   where id = p_id
     and edit_token_hash = encode(extensions.digest(p_edit_token, 'sha256'), 'hex');

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- Lock down function execution, then grant only what each role needs.
revoke all on function public.create_surfboard_project(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.list_owned_surfboard_projects() from public, anon, authenticated;
revoke all on function public.get_owned_surfboard_project(uuid) from public, anon, authenticated;
revoke all on function public.save_owned_surfboard_project(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.delete_owned_surfboard_project(uuid) from public, anon, authenticated;
revoke all on function public.get_owned_surfboard_edit_token(uuid) from public, anon, authenticated;
revoke all on function public.adopt_owned_surfboard_edit_token(uuid,text) from public, anon, authenticated;
revoke all on function public.get_surfboard_project(uuid,text) from public, anon, authenticated;
revoke all on function public.save_surfboard_project(uuid,text,jsonb) from public, anon, authenticated;

grant execute on function public.create_surfboard_project(text,text,jsonb) to authenticated;
grant execute on function public.list_owned_surfboard_projects() to authenticated;
grant execute on function public.get_owned_surfboard_project(uuid) to authenticated;
grant execute on function public.save_owned_surfboard_project(uuid,jsonb) to authenticated;
grant execute on function public.delete_owned_surfboard_project(uuid) to authenticated;
grant execute on function public.get_owned_surfboard_edit_token(uuid) to authenticated;
grant execute on function public.adopt_owned_surfboard_edit_token(uuid,text) to authenticated;

grant execute on function public.get_surfboard_project(uuid,text) to anon, authenticated;
grant execute on function public.save_surfboard_project(uuid,text,jsonb) to anon, authenticated;

-- Refresh PostgREST's schema cache.
notify pgrst, 'reload schema';
