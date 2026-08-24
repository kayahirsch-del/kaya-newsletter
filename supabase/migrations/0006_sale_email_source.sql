-- ===========================================================================
-- HERESAY — sample sales by inbound email
--
-- The Haul had no source. The obvious one — fetching the sale calendars that
-- aggregate this stuff — is closed off at the two best sites, and they said
-- so themselves:
--
--   vipsamplesale.com/robots.txt  names anthropic-ai, ClaudeBot, GPTBot,
--                                 CCBot, Bytespider and others as disallowed
--   soifferhaskin.com/robots.txt  Disallow: / with a search-engine allowlist
--
-- Rather than route around that, this source inverts it. Every one of these
-- vendors runs a mailing list and wants the sale attended, so we subscribe at
-- sales@itsallheresay.com and read what they send us. Consent is explicit,
-- the feed can't break from a markup change, and the announcement carries
-- brand, dates, hours and street address — more than the listing pages show.
--
-- No `feeds` config here: what arrives is decided by which lists we join, not
-- by anything stored in this row.
-- ===========================================================================

insert into public.content_sources (id, label, city_id, category, config) values
  ('salemail', 'Sample sale announcements (inbound email)', 'nyc', 'haul',
   jsonb_build_object(
     'inbox', 'sales@itsallheresay.com',
     -- Recorded for us, not read by the function. The list of senders we have
     -- actually subscribed to, so a year from now it's clear where a candidate
     -- came from and which lists to re-join if the inbox is ever rebuilt.
     'subscribed', jsonb_build_array(
        'vipsamplesale.com', 'soifferhaskin.com', 'arlettie.com',
        '260samplesale.com', 'clothingline.com', 'chicmi.com'
     )
   ))
on conflict (id) do update set
  label  = excluded.label,
  config = excluded.config;
