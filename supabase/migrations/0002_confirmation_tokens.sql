-- ===========================================================================
-- SPOTTED — double opt-in + unsubscribe tokens
--
-- Tokens only. The anon insert policy stays in place here: the browser still
-- writes through PostgREST at this point, and revoking it would break signups
-- on the live site. It is withdrawn in 0003, once the subscribe edge function
-- is deployed and the client posts there instead.
-- ===========================================================================

alter table public.subscribers
  add column if not exists confirm_token     uuid not null default gen_random_uuid(),
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid(),
  add column if not exists confirmed_at      timestamptz;

-- Both tokens are looked up directly from an emailed link, so index them.
create unique index if not exists subscribers_confirm_token_idx
  on public.subscribers (confirm_token);

create unique index if not exists subscribers_unsubscribe_token_idx
  on public.subscribers (unsubscribe_token);
