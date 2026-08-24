-- ===========================================================================
-- HERESAY — issues
--
-- Turning approved candidates into a sent newsletter. An issue is one
-- edition for one city on one date. It is NOT one email: every subscriber
-- gets a different set of items, because the whole promise is that it's
-- about their ten blocks. `issue_sends` records what each person actually
-- received, which is what makes the send resumable and auditable.
--
-- Nothing sends itself by default. See `cities.newsletter->auto_send`.
-- ===========================================================================

create table if not exists public.issues (
  id         uuid primary key default gen_random_uuid(),
  city_id    text not null references public.cities(id),
  send_on    date not null,

  status     text not null default 'draft'
               check (status in ('draft','ready','sending','sent','cancelled')),

  -- Written by a human before it goes out. The model drafts candidates; the
  -- voice of the issue itself is hers.
  subject    text,
  intro      text,

  created_at timestamptz not null default now(),
  sent_at    timestamptz,

  -- One edition per city per day. Re-running the builder updates the draft
  -- instead of quietly creating a second one.
  unique (city_id, send_on)
);

-- ---------------------------------------------------------------------------
-- Per-subscriber record. Written at build time so the issue can be previewed
-- exactly as it will send, and so a send interrupted halfway can resume
-- without mailing anyone twice.
-- ---------------------------------------------------------------------------

create table if not exists public.issue_sends (
  issue_id      uuid not null references public.issues(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,

  -- The exact items this person is getting, in order. Snapshotted rather than
  -- recomputed at send time: an editor approving something mid-send should
  -- not change what a preview promised.
  item_ids      uuid[] not null default '{}',

  status        text not null default 'queued'
                  check (status in ('queued','sent','skipped','failed')),

  -- Why a person got nothing. 'thin' means their neighborhood and the
  -- city-wide fallback together couldn't clear min_items — worth knowing in
  -- aggregate, because it's the signal that ingestion isn't keeping up.
  reason        text,

  sent_at       timestamptz,
  error         text,

  primary key (issue_id, subscriber_id)
);

create index if not exists issue_sends_pending_idx
  on public.issue_sends (issue_id, status);

-- ---------------------------------------------------------------------------
-- Which items have been in which issue. An item can legitimately appear for
-- many subscribers in one edition, but should never appear twice for the
-- same person across editions.
-- ---------------------------------------------------------------------------

create table if not exists public.issue_items (
  issue_id uuid not null references public.issues(id) on delete cascade,
  item_id  uuid not null references public.items(id) on delete cascade,
  primary key (issue_id, item_id)
);

-- ---------------------------------------------------------------------------
-- Cadence and guardrails, per city, in jsonb so tuning needs no migration —
-- same pattern as content_sources.config.
-- ---------------------------------------------------------------------------

alter table public.cities
  add column if not exists newsletter jsonb not null default '{}';

update public.cities set newsletter = jsonb_build_object(
  -- Biweekly. The scheduler runs weekly and skips if the last issue went out
  -- fewer than this many days ago, which self-heals a missed week instead of
  -- drifting the schedule permanently.
  'cadence_days', 14,
  'send_dow', 4,                 -- Thursday, matching the site's promise
  'send_hour_utc', 13,           -- 9am ET

  -- Below this many items a person gets nothing rather than a thin issue.
  -- An empty newsletter is worse than a skipped one: it trains people to
  -- ignore the sender.
  'min_items', 3,
  'max_items', 8,

  -- When the neighborhood alone can't fill an issue, top up with the best of
  -- the rest of the city under a separate heading. Honest about what it is.
  'citywide_fallback', true,

  -- Off deliberately. The scheduler builds a draft and tells a human; a
  -- human sends it. Flip to true only once the drafts have been boring for
  -- a few cycles.
  'auto_send', false
) where id = 'nyc';

alter table public.issues      enable row level security;
alter table public.issue_sends enable row level security;
alter table public.issue_items enable row level security;
