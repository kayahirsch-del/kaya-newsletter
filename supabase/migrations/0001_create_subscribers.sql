-- ===========================================================================
-- HERESAY — subscribers table
-- ===========================================================================

create extension if not exists pgcrypto;

create table if not exists public.subscribers (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),

  first_name     text not null check (char_length(trim(first_name)) between 1 and 80),
  email          text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
                                      and char_length(email) <= 254),

  city           text not null check (char_length(city) between 1 and 80),
  city_id        text not null check (char_length(city_id) between 1 and 20),
  neighborhood   text not null check (char_length(neighborhood) between 1 and 80),
  street_address text check (char_length(street_address) <= 160),

  -- array_length() is NULL for an empty array, and a NULL CHECK passes —
  -- coalesce so that "at least one interest" is actually enforced.
  interests      text[] not null default '{}'
                   check (coalesce(array_length(interests, 1), 0) between 1 and 20),

  cadence        text not null default 'weekly'
                   check (cadence in ('weekly', 'twice_weekly', 'monthly')),

  status         text not null default 'pending'
                   check (status in ('pending', 'confirmed', 'unsubscribed')),
  source         text check (char_length(source) <= 40),

  unsubscribed_at timestamptz
);

-- One row per human, case-insensitively. The client lowercases before sending;
-- this index is what actually guarantees it.
create unique index if not exists subscribers_email_key
  on public.subscribers (lower(email));

-- Segmenting a send by neighborhood is the most common query, so index it.
create index if not exists subscribers_city_hood_idx
  on public.subscribers (city_id, lower(neighborhood))
  where status <> 'unsubscribed';

create index if not exists subscribers_interests_idx
  on public.subscribers using gin (interests);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The anon key ships in the browser, so the table must be write-only to it:
-- anyone may add themselves to the list, nobody may read the list back.
-- Reading and sending happen with the service-role key, server-side only.
-- ---------------------------------------------------------------------------

alter table public.subscribers enable row level security;

drop policy if exists "anon can subscribe" on public.subscribers;
create policy "anon can subscribe"
  on public.subscribers
  for insert
  to anon
  with check (
    -- WITH CHECK runs after column defaults are applied, so a client that
    -- omits these still passes; a client that forges them does not.
    status = 'pending'
    and unsubscribed_at is null
  );

-- No select / update / delete policies for anon by design.
-- With RLS on and no matching policy, those operations are denied.
