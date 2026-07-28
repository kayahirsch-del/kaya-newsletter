-- ===========================================================================
-- HERESAY — withdraw the anon insert grant
--
-- NOT YET APPLIED. Run this only once the client that posts to the
-- `subscribe` edge function is actually deployed and serving.
--
-- Ordering matters: the previously deployed client wrote to PostgREST
-- directly. Dropping this policy before the new bundle is live would
-- 401 every signup in the gap, including anyone holding a cached copy of
-- the old JavaScript.
--
-- After this runs, `subscribers` has RLS enabled and zero policies, so every
-- anonymous operation is denied. The edge functions use the service-role key,
-- which bypasses RLS, and are the only writers.
-- ===========================================================================

drop policy if exists "anon can subscribe" on public.subscribers;
