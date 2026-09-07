-- Surfboard Color Studio cloud backend
-- Run this file once in Supabase Dashboard -> SQL Editor.
-- It stores the image and masks in Postgres and exposes only token-protected RPC functions.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.surfboard_projects (
  id uuid primary key default gen_random_uuid(),
  edit_token_hash text not null,
  view_token_hash text not null,
  image_data text not null,
  project_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.surfboard_projects enable row level security;

-- Browser clients never access the table directly. They only call the RPCs below.
revoke all on table public.surfboard_projects from anon, authenticated;

create or replace function public.create_surfboard_project(
  p_edit_token text,
  p_view_token text,
  p_image_data text,
  p_project_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid;
begin
  if length(coalesce(p_edit_token, '')) < 20 or length(coalesce(p_view_token, '')) < 20 then
    raise exception 'invalid token';
  end if;

  if length(coalesce(p_image_data, '')) < 32 then
    raise exception 'invalid image';
  end if;

  insert into public.surfboard_projects (
    edit_token_hash,
    view_token_hash,
    image_data,
    project_data
  ) values (
    encode(digest(p_edit_token, 'sha256'), 'hex'),
    encode(digest(p_view_token, 'sha256'), 'hex'),
    p_image_data,
    coalesce(p_project_data, '{}'::jsonb)
  )
  returning id into new_id;

  return new_id;
end;
$$;

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
set search_path = public, extensions
as $$
  select
    p.id,
    p.image_data,
    p.project_data,
    p.created_at,
    p.updated_at,
    case
      when p.edit_token_hash = encode(digest(p_token, 'sha256'), 'hex') then 'edit'
      else 'view'
    end as access_level
  from public.surfboard_projects p
  where p.id = p_id
    and (
      p.edit_token_hash = encode(digest(p_token, 'sha256'), 'hex')
      or p.view_token_hash = encode(digest(p_token, 'sha256'), 'hex')
    )
  limit 1;
$$;

create or replace function public.save_surfboard_project(
  p_id uuid,
  p_edit_token text,
  p_project_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  changed integer;
begin
  update public.surfboard_projects
  set
    project_data = coalesce(p_project_data, '{}'::jsonb),
    updated_at = now()
  where id = p_id
    and edit_token_hash = encode(digest(p_edit_token, 'sha256'), 'hex');

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.delete_surfboard_project(
  p_id uuid,
  p_edit_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  changed integer;
begin
  delete from public.surfboard_projects
  where id = p_id
    and edit_token_hash = encode(digest(p_edit_token, 'sha256'), 'hex');

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.create_surfboard_project(text,text,text,jsonb) from public;
revoke all on function public.get_surfboard_project(uuid,text) from public;
revoke all on function public.save_surfboard_project(uuid,text,jsonb) from public;
revoke all on function public.delete_surfboard_project(uuid,text) from public;

grant execute on function public.create_surfboard_project(text,text,text,jsonb) to anon, authenticated;
grant execute on function public.get_surfboard_project(uuid,text) to anon, authenticated;
grant execute on function public.save_surfboard_project(uuid,text,jsonb) to anon, authenticated;
grant execute on function public.delete_surfboard_project(uuid,text) to anon, authenticated;
