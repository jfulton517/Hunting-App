-- Hunt Forecast database schema.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- It is safe to run more than once.
--
-- Every table has row-level security: a signed-in user can only see and change
-- their own rows, and only their own trail-cam photos.

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.places (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  lat double precision not null,
  lon double precision not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.stands (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  place_id uuid references public.places on delete set null,
  name text not null,
  lat double precision,
  lon double precision,
  winds text[] not null default '{}',
  kind text not null default 'stand',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.cameras (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  place_id uuid references public.places on delete set null,
  name text not null,
  lat double precision,
  lon double precision,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.deer (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  sex text not null default 'buck',
  description text not null default '',
  points integer,
  age_class text not null default 'unknown',
  is_target boolean not null default false,
  status text not null default 'active',
  reference_sighting_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.sightings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  camera_id uuid references public.cameras on delete set null,
  deer_id uuid references public.deer on delete set null,
  taken_at timestamptz not null,
  time_source text not null default 'manual',
  photo_path text,
  photo_hash text,
  photo_phash text,
  kind text not null default 'unknown',
  status text not null default 'pending',
  ai jsonb,
  weather jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.hunts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  species text not null default 'deer',
  stand_id uuid references public.stands on delete set null,
  target_deer_id uuid references public.deer on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  events jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Added after the first release; safe if the column already exists.
alter table public.sightings add column if not exists photo_hash text;
alter table public.sightings add column if not exists photo_phash text;
alter table public.cameras add column if not exists stand_id uuid references public.stands on delete set null;
alter table public.stands add column if not exists facing text;

create index if not exists sightings_user_deer on public.sightings (user_id, deer_id);
create index if not exists sightings_user_hash on public.sightings (user_id, photo_hash);
create index if not exists sightings_user_taken on public.sightings (user_id, taken_at);

-- Row-level security: each user only sees their own rows.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'places', 'stands', 'cameras', 'deer', 'sightings', 'hunts'] loop
    execute format('alter table public.%I enable row level security', t);
    -- Newer Supabase projects don't expose new tables to the API automatically: signed-in
    -- users need explicit access (the policy below still limits them to their own rows).
    -- Anonymous visitors get none.
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Private bucket for trail-cam photos, stored as <user id>/<photo id>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trailcam', 'trailcam', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "own trailcam photos read" on storage.objects;
drop policy if exists "own trailcam photos insert" on storage.objects;
drop policy if exists "own trailcam photos update" on storage.objects;
drop policy if exists "own trailcam photos delete" on storage.objects;

create policy "own trailcam photos read" on storage.objects for select to authenticated
  using (bucket_id = 'trailcam' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own trailcam photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'trailcam' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own trailcam photos update" on storage.objects for update to authenticated
  using (bucket_id = 'trailcam' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own trailcam photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'trailcam' and (storage.foldername(name))[1] = (select auth.uid())::text);
