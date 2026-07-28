-- ===========================================================================
-- HERESAY — withdraw the anon insert grant
--
-- Applied. Signups go through the `subscribe` edge function, which holds the
-- service-role key, so the browser needs no write access to this table.
--
-- Ordering mattered: the earlier client wrote to PostgREST directly, and
-- dropping this policy before that bundle was replaced would have 401'd every
-- signup in the gap, including anyone holding cached JavaScript.
--
-- `subscribers` now has RLS enabled and zero policies, so every anonymous
-- operation is denied. Supabase's linter reports this as
-- `rls_enabled_no_policy` at INFO level — that is the intended end state
-- here, not a finding: the table is deliberately unreachable by the anon
-- role, and the edge functions bypass RLS via the service-role key.
-- ===========================================================================

drop policy if exists "anon can subscribe" on public.subscribers;
