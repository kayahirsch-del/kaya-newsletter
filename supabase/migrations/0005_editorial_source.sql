-- ===========================================================================
-- HERESAY — editorial feeds
--
-- The liquor-licence feed answers "does this place exist"; it has no opinion.
-- These three publications do. We read their public feeds, keep the headline,
-- their own summary and the link, and send the reader to them. No article
-- bodies are stored, and none of this is training data.
--
-- Each feed carries its own topic filters. The first run without them pulled
-- a five-alarm fire, two stabbings and an alternate-side parking story into a
-- newsletter about where to eat, because those stories do name neighborhoods
-- we serve. A neighborhood match proves a story is about here; it says nothing
-- about whether it belongs. Hence allow_paths / deny_paths / deny_words.
-- ===========================================================================

insert into public.content_sources (id, label, city_id, category, config) values
  ('editorial', 'Local editorial feeds', 'nyc', 'other',
   jsonb_build_object(
     -- Applied to every feed. Padded word match, so "fire" here does not
     -- reject a headline about a firehouse-turned-cocktail-bar.
     'deny_words', jsonb_build_array(
        'shooting','shootings','stabbing','stabbings','shot','stabbed',
        'killed','dead','death','fire','arrested','charged','indicted',
        'lawsuit','sued','crash','subpoena','eviction','rent','landlord',
        'mta','parking','nypd','police','mayor','council','governor','election'
     ),
     'feeds', jsonb_build_array(
       jsonb_build_object(
         'name', 'Eater NY',
         'url', 'https://ny.eater.com/rss/index.xml',
         'category', 'table',
         -- Eater is already all restaurants. Its "news" section is restaurant
         -- news, so no path filter — the shared deny_words are enough.
         'deny_paths', jsonb_build_array('/maps/')
       ),
       jsonb_build_object(
         'name', 'Gothamist',
         'url', 'https://gothamist.com/feed',
         'category', 'other',
         -- Gothamist's main feed is general city news and mostly not for us,
         -- but it namespaces sections in the URL, so the good half is easy to
         -- keep: /food/ and /arts-entertainment/ only.
         'allow_paths', jsonb_build_array('/food/', '/arts-entertainment/')
       ),
       jsonb_build_object(
         'name', 'Secret NYC',
         'url', 'https://secretnyc.co/feed/',
         'category', 'lineup',
         -- Flat URLs, no sections to filter on. It also leans hard on
         -- local-history posts — pleasant, but not a reason to leave the
         -- apartment this week.
         'deny_words', jsonb_build_array(
            'history','historic','built','dating','abandoned','forgotten',
            'oldest','photos','vintage'
         )
       )
     )
   ))
on conflict (id) do update set config = excluded.config;

-- The rows the unfiltered first run already filed. Deleting rather than
-- rejecting: they were never candidates, and leaving them as `rejected` would
-- imply an editor looked at them and said no.
delete from public.items
where source_id = 'editorial'
  and (   url like 'https://gothamist.com/news/%'
       or url like '%secretnyc.co/sylvan-terrace%'
       or url like '%secretnyc.co/essex-market-les%');
