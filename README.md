# HERESAY

A hyperlocal newsletter for young women — the restaurants, sample sales, and
shows worth leaving the apartment for, filtered down to one neighborhood.

This repo is the **signup page**: a landing page + personalization form that
captures name, email, city, neighborhood, optional street address, interests,
and send cadence.

The name is a pun that has to be seen to land: **HERE**SAY, as in what's
happening *here*. Spoken aloud it's just "hearsay", so the wordmark carries
the joke — `.brand-lead` wraps the first four letters wherever the name
appears. A dictionary entry under the hero explains it once, in the site's
own voice.

Because it needs markup rather than a plain string, the name is not a config
value. It lives in the HTML, and in `BRAND` in
`supabase/functions/_shared/brand.ts` for email.

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
browsers pinned to a stale `config.js` after you change the interest list or
the Supabase credentials. Vercel's defaults revalidate correctly.

---

## What's where

```
index.html                              landing page + signup form
assets/css/styles.css                   all styling
assets/js/config.js                     interests, cadences, Supabase creds
assets/js/neighborhoods.js              city → neighborhood lists
assets/js/app.js                        form building, validation, submit
supabase/migrations/0001_*.sql          subscribers table, indexes, RLS
```

### Editing the form

Both the interest chips and the cadence options are rendered from
`config.js` — add an entry to the array and it appears on the page. The `id`
is what gets stored, so don't change ids once real people have signed up.

### Adding a city

Append to `HERESAY_CITIES` in `assets/js/neighborhoods.js`. The neighborhood
field is free text with autocomplete, so anything missing from the list can
still be typed; `normalizeHood()` snaps typed values onto the canonical
spelling when they match, which keeps "west village", "WEST VILLAGE", and
"West  Village" from becoming three different segments.

---

## Email

Signups post to the `subscribe` edge function, not to the table. The function
holds the service-role key, writes the row, and sends a double opt-in email
through [Resend](https://resend.com). The browser has no write access to
`subscribers` at all.

```
supabase/functions/subscribe/     validates, inserts, sends the confirm email
supabase/functions/confirm/       pending → confirmed
supabase/functions/unsubscribe/   → unsubscribed
supabase/functions/_shared/       email template, redirect helper, brand name
```

### Secrets

Set these under **Supabase → Project Settings → Edge Functions → Secrets**.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

| Secret | Required | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | Without it, signups still save and the page stops claiming an email was sent |
| `SITE_URL` | yes | Origin of the deployed site, e.g. `https://spotted-newsletter.vercel.app`, no trailing slash. Where the emailed links land |
| `FROM_EMAIL` | no | Defaults to Resend's shared `onboarding@resend.dev`. Set a verified domain before real sends |
| `REPLY_TO` | no | Only needed once mail comes from an address nobody reads |
| `ADMIN_TOKEN` | for `/review` | Shared secret for the back office. Unset means `review` refuses every request |

### Why the landing pages aren't served by the functions

Supabase's gateway rewrites every edge function response to
`Content-Type: text/plain` and attaches
`content-security-policy: default-src 'none'; sandbox`. A browser will not
render markup returned from `*.supabase.co` — it displays the source as text.

So `confirm` and `unsubscribe` do the database write and then `302` to
`confirmed.html` / `unsubscribe.html` on the static site, passing state in the
query string. Those pages read the state with `textContent`, never `innerHTML`,
since the values arrive from the URL.

If `SITE_URL` is unset the functions still perform the write correctly, but
they have nowhere to send the browser and fall back to a plain-text message.

Nothing hard-fails when `RESEND_API_KEY` is missing: the row commits, the
function logs a warning, and the success page omits the "check your inbox"
line rather than promising mail that isn't coming.

### Why unsubscribe splits GET and POST

`GET /unsubscribe` redirects to a one-button confirmation page; `POST` performs
the write. Corporate mail scanners and link-preview bots fetch every URL in an
inbound email, and if `GET` did the write those prefetches would silently
unsubscribe people who never clicked. The `POST` also satisfies RFC 8058
one-click, so a mail client's native unsubscribe button still works in one step.

---

## Content pipeline

Ingestion fills `items` with candidates; a human approves what ships.
`cities`, `content_sources`, `items` and `postal_neighborhoods` are all
multi-city from the start, so adding a city is data plus a source adapter
rather than a migration. Per-source settings live in `content_sources.config`
as JSONB, so retuning a filter needs no redeploy.

```
supabase/functions/ingest-nysla/  NY liquor licences -> candidates
supabase/functions/review/        back-office list/update API
review.html                       the triage queue
```

### Why liquor licences

A licence is issued before a venue opens, so it surfaces bars and restaurants
ahead of any listings site — and it's public record, free, structured and
geocoded.

Ingestion is recall-first: everything lands as `status = 'new'` for a human.
Two known sources of noise, deliberately left in rather than filtered blind:

- The dataset is *current active licences*, so a renewal or class change at a
  long-established venue gets a fresh issue date and looks new.
- ZIP-to-neighborhood is coarse. `10001` spans Chelsea, Koreatown and Hudson
  Yards; `10011` spans Chelsea and the West Village. `lat`/`lng` is stored on
  every row, so moving to point-in-polygon (PostGIS + NTA boundaries) needs no
  re-ingest.

The Socrata fetch is capped at 1000 rows and does not paginate yet, so a long
lookback silently truncates.

### The review queue

`/review` on the deployed site. It is `noindex` and gated on `ADMIN_TOKEN`,
which the browser keeps in `localStorage` and sends in the request body.

That single shared secret is a deliberate choice for a one-person tool, not a
security claim: anyone holding it can read and re-status every item. It is
scoped to `items` only — the `review` function has no path to `subscribers`.
Move to Supabase Auth before a second person needs access.

Triage is keyboard-driven — <kbd>J</kbd>/<kbd>K</kbd> to move,
<kbd>A</kbd> approve, <kbd>R</kbd> reject, <kbd>U</kbd> back to new — and
status changes apply optimistically, reverting if the server refuses.

---

## Not built yet

- The Lineup and The Haul have no sources yet — only The Table is fed
- Pagination on the Socrata fetch
- Issue assembly: turning approved items into a sent newsletter
- Admin view of the subscriber list
- Rate limiting on `subscribe`. It's a public endpoint that sends mail, so it
  is abusable for mailbombing a single address; Resend's own limits are
  currently the only ceiling.
