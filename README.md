# SPOTTED

A hyperlocal newsletter for young women — the restaurants, sample sales, and
shows worth leaving the apartment for, filtered down to one neighborhood.

This repo is the **signup page**: a landing page + personalization form that
captures name, email, city, neighborhood, optional street address, interests,
and send cadence.

`SPOTTED` is a working title. It lives in one place — `brand` in
`assets/js/config.js` — so renaming is a one-line change.

---

## Running it

No build step, no dependencies. Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Out of the box, signups are written to `localStorage` and logged to the
console, so the whole flow is clickable before any backend exists.

## Connecting Supabase

1. Run `supabase/migrations/0001_create_subscribers.sql` against your project
   (Supabase dashboard → SQL Editor, or `supabase db push`).
2. Fill in `supabase` in `assets/js/config.js`:

```js
supabase: {
  url:     "https://xxxxxxxx.supabase.co",
  anonKey: "sb_publishable_…",
  table:   "subscribers"
}
```

The publishable (anon) key is meant to be public. What protects the list is
row-level security: the policy in the migration lets anonymous visitors
**insert** a row and nothing else — no anonymous client can read, update, or
delete the subscriber list. Do all reading and sending server-side with the
service-role key, and never put that key in this repo.

A duplicate email comes back as a `409` and is treated as success ("you're
already in") rather than an error.

## Deploying

Any static host. Push the repo and point Vercel / Netlify / GitHub Pages at
the root — there's nothing to compile.

On Vercel: import the repo, framework preset **Other**, and leave the build
command and output directory empty. `vercel.json` sets a few baseline
security headers.

It deliberately does *not* set long-lived cache headers. Filenames here
aren't content-hashed, so an `immutable` policy on `assets/` would leave
browsers pinned to a stale `config.js` after you change the brand name or the
interest list. Vercel's defaults revalidate correctly.

---

## What's where

```
index.html                              landing page + signup form
assets/css/styles.css                   all styling
assets/js/config.js                     brand, interests, cadences, Supabase creds
assets/js/neighborhoods.js              city → neighborhood lists
assets/js/app.js                        form building, validation, submit
supabase/migrations/0001_*.sql          subscribers table, indexes, RLS
```

### Editing the form

Both the interest chips and the cadence options are rendered from
`config.js` — add an entry to the array and it appears on the page. The `id`
is what gets stored, so don't change ids once real people have signed up.

### Adding a city

Append to `SPOTTED_CITIES` in `assets/js/neighborhoods.js`. The neighborhood
field is free text with autocomplete, so anything missing from the list can
still be typed; `normalizeHood()` snaps typed values onto the canonical
spelling when they match, which keeps "west village", "WEST VILLAGE", and
"West  Village" from becoming three different segments.

---

## Not built yet

- Double opt-in confirmation email
- Unsubscribe endpoint (the column exists, the route doesn't)
- Content pipeline — sourcing and assembling the actual issues
- Admin view of the subscriber list
