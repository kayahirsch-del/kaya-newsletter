-- ===========================================================================
-- HERESAY — content pipeline
--
-- Ingestion fills `items` with candidates; a human approves what ships. The
-- schema is multi-city from the start even though only NYC is wired up, so
-- adding a city is data plus a source adapter, never a migration.
-- ===========================================================================

create table if not exists public.cities (
  id       text primary key,                    -- matches city_id on subscribers
  label    text not null,
  timezone text not null default 'America/New_York',
  enabled  boolean not null default true
);

insert into public.cities (id, label, timezone, enabled) values
  ('nyc', 'New York',      'America/New_York',    true),
  ('la',  'Los Angeles',   'America/Los_Angeles', false),
  ('chi', 'Chicago',       'America/Chicago',     false),
  ('sf',  'San Francisco', 'America/Los_Angeles', false),
  ('mia', 'Miami',         'America/New_York',    false),
  ('atx', 'Austin',        'America/Chicago',     false),
  ('bos', 'Boston',        'America/New_York',    false),
  ('dc',  'Washington, DC','America/New_York',    false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sources. `config` holds adapter-specific settings (dataset ids, counties,
-- lookback windows) so tuning a source doesn't require a redeploy.
-- ---------------------------------------------------------------------------

create table if not exists public.content_sources (
  id           text primary key,
  label        text not null,
  city_id      text references public.cities(id),   -- null = not city-specific
  category     text not null,
  enabled      boolean not null default true,
  config       jsonb not null default '{}',
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  last_count   integer
);

insert into public.content_sources (id, label, city_id, category, config) values
  ('nysla', 'NY State Liquor Authority — new licenses', 'nyc', 'table',
   jsonb_build_object(
     'dataset', '9s3h-dpkz',
     'counties', jsonb_build_array('NEW YORK','KINGS','QUEENS','BRONX','RICHMOND'),
     'lookback_days', 30,
     -- License classes that mean "somewhere you'd actually go". Everything
     -- else in this dataset is groceries, delis, wholesalers and boats.
     'keep_descriptions', jsonb_build_array(
        'Restaurant','Food & Beverage Business','Tavern','Cabaret','Club',
        'Hotel','Catering Establishment','Bar','Brewery','Distillery','Winery'
     )
   ))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Candidate pool.
-- ---------------------------------------------------------------------------

create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  source_id    text not null references public.content_sources(id),
  external_id  text not null,                     -- stable id from the source

  -- Maps to the three beats on the site: The Table / The Lineup / The Haul.
  category     text not null
                 check (category in ('table','lineup','haul','other')),

  title        text not null,
  blurb        text,
  url          text,

  venue_name   text,
  address      text,
  postal_code  text,
  city_id      text not null references public.cities(id),
  neighborhood text,
  lat          double precision,
  lng          double precision,

  starts_at    timestamptz,
  ends_at      timestamptz,

  status       text not null default 'new'
                 check (status in ('new','approved','rejected','published')),
  notes        text,
  raw          jsonb,

  unique (source_id, external_id)
);

-- Reviewing the queue and building an issue are both "this city, this
-- neighborhood, not yet dealt with".
create index if not exists items_review_idx
  on public.items (city_id, status, created_at desc);

create index if not exists items_hood_idx
  on public.items (city_id, lower(neighborhood), status)
  where status in ('new','approved');

create index if not exists items_starts_idx
  on public.items (starts_at) where starts_at is not null;

-- ---------------------------------------------------------------------------
-- Postal code → neighborhood. The SLA feed gives an address and a ZIP but no
-- neighborhood, and subscribers pick a neighborhood by name, so something has
-- to bridge them. ZIPs are coarse and imperfect — a ZIP can straddle two
-- neighborhoods — but they resolve most of NYC correctly with no geocoding
-- dependency. Swap in point-in-polygon (PostGIS + NTA boundaries) when
-- precision starts to matter.
-- ---------------------------------------------------------------------------

create table if not exists public.postal_neighborhoods (
  city_id      text not null references public.cities(id),
  postal_code  text not null,
  neighborhood text not null,
  primary key (city_id, postal_code)
);

insert into public.postal_neighborhoods (city_id, postal_code, neighborhood) values
  -- Manhattan
  ('nyc','10001','Chelsea'), ('nyc','10011','Chelsea'),
  ('nyc','10018','Midtown West'), ('nyc','10036','Hell''s Kitchen'),
  ('nyc','10019','Hell''s Kitchen'), ('nyc','10020','Midtown West'),
  ('nyc','10022','Midtown East'), ('nyc','10017','Midtown East'),
  ('nyc','10016','Murray Hill'), ('nyc','10010','Gramercy'),
  ('nyc','10003','East Village'), ('nyc','10009','East Village'),
  ('nyc','10002','Lower East Side'), ('nyc','10012','SoHo'),
  ('nyc','10013','Tribeca'), ('nyc','10007','Tribeca'),
  ('nyc','10014','West Village'), ('nyc','10011','Chelsea'),
  ('nyc','10004','Financial District'), ('nyc','10005','Financial District'),
  ('nyc','10006','Financial District'), ('nyc','10038','Financial District'),
  ('nyc','10280','Battery Park City'),
  ('nyc','10023','Upper West Side'), ('nyc','10024','Upper West Side'),
  ('nyc','10025','Upper West Side'), ('nyc','10069','Upper West Side'),
  ('nyc','10021','Upper East Side'), ('nyc','10028','Upper East Side'),
  ('nyc','10065','Upper East Side'), ('nyc','10075','Upper East Side'),
  ('nyc','10128','Yorkville'), ('nyc','10029','East Harlem'),
  ('nyc','10026','Harlem'), ('nyc','10027','Harlem'),
  ('nyc','10030','Harlem'), ('nyc','10031','Harlem'),
  ('nyc','10032','Washington Heights'), ('nyc','10033','Washington Heights'),
  ('nyc','10040','Washington Heights'), ('nyc','10034','Inwood'),
  ('nyc','10115','Morningside Heights'), ('nyc','10044','Roosevelt Island'),
  -- Brooklyn
  ('nyc','11211','Williamsburg'), ('nyc','11249','Williamsburg'),
  ('nyc','11222','Greenpoint'), ('nyc','11206','East Williamsburg'),
  ('nyc','11237','Bushwick'), ('nyc','11221','Bushwick'),
  ('nyc','11216','Bedford-Stuyvesant'), ('nyc','11233','Bedford-Stuyvesant'),
  ('nyc','11238','Prospect Heights'), ('nyc','11217','Park Slope'),
  ('nyc','11215','Park Slope'), ('nyc','11231','Carroll Gardens'),
  ('nyc','11201','Brooklyn Heights'), ('nyc','11205','Fort Greene'),
  ('nyc','11225','Crown Heights'), ('nyc','11213','Crown Heights'),
  ('nyc','11226','Prospect Lefferts Gardens'), ('nyc','11218','Windsor Terrace'),
  ('nyc','11220','Sunset Park'), ('nyc','11232','Sunset Park'),
  ('nyc','11209','Bay Ridge'), ('nyc','11385','Ridgewood'),
  -- Queens
  ('nyc','11101','Long Island City'), ('nyc','11106','Astoria'),
  ('nyc','11102','Astoria'), ('nyc','11103','Astoria'),
  ('nyc','11104','Sunnyside'), ('nyc','11377','Woodside'),
  ('nyc','11372','Jackson Heights'), ('nyc','11373','Elmhurst'),
  ('nyc','11375','Forest Hills'), ('nyc','11354','Flushing'),
  ('nyc','11694','Rockaway Beach'),
  -- Bronx
  ('nyc','10454','Mott Haven'), ('nyc','10455','Mott Haven'),
  ('nyc','10471','Riverdale'), ('nyc','10458','Fordham')
on conflict (city_id, postal_code) do nothing;

-- ---------------------------------------------------------------------------
-- Same posture as `subscribers`: RLS on, no policies. Only the edge functions,
-- holding the service-role key, touch any of this.
-- ---------------------------------------------------------------------------

alter table public.cities                enable row level security;
alter table public.content_sources       enable row level security;
alter table public.items                 enable row level security;
alter table public.postal_neighborhoods  enable row level security;
