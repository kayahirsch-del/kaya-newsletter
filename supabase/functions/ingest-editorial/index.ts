/* ===========================================================================
   POST /functions/v1/ingest-editorial

   Reads public RSS/Atom feeds from local publications and files anything that
   names a neighborhood we serve as a candidate.

   Why feeds and not scraping: a feed is published for exactly this — read the
   headline and summary, link back, send the reader to the source. We store the
   title, the feed's own summary, and the link. We do not store article bodies,
   and nothing here is training data — this is retrieval. The publication keeps
   the traffic and the credit.

   What it adds over the licence feed: taste. A licence says a place exists; an
   editor saying it's worth going is a quality signal, and that's the half the
   licence data can't give us.

   Taste cuts both ways, though. Gothamist's main feed is a general news feed —
   the first run pulled five-alarm fires, two stabbings and an alternate-side
   parking story alongside the one good restaurant round-up. A neighborhood
   name in a headline means the story is *about* here; it does not mean it
   belongs in this newsletter. So each feed carries its own filters in
   `content_sources.config`, tunable without a redeploy:

     allow_paths  URL path fragments that must appear (e.g. "/food/")
     deny_paths   URL path fragments that disqualify  (e.g. "/news/")
     deny_words   headline words that disqualify regardless of path

   Paths are the precise filter where a publication namespaces its sections;
   deny_words is the backstop for the ones that don't.
   =========================================================================== */

import { CORS, json } from "../_shared/brand.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1`;

const restHeaders = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

const SOURCE_ID = "editorial";

type Feed = {
  name: string;
  url: string;
  category: string;
  allow_paths?: string[];
  deny_paths?: string[];
  deny_words?: string[];
};
type Entry = { title: string; link: string; summary: string; published?: string };

/* ── tiny feed parser ──────────────────────────────────────────────────────
   Deno has no built-in XML parser and pulling one in for two element shapes
   isn't worth the dependency. Feeds are machine-generated and regular, so
   targeted extraction holds up — and a malformed entry is skipped, not fatal. */

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")               // strip markup from summaries
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&hellip;|&#8230;/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

function parseFeed(xml: string): Entry[] {
  /* Atom uses <entry>, RSS uses <item>. Try both. */
  const blocks = [
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
  ].map((m) => m[0]);

  return blocks.flatMap((b) => {
    const title = tag(b, "title");

    /* RSS puts the URL in <link>text</link>; Atom in <link href="..."/>. */
    let link = tag(b, "link");
    if (!link) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = href ? href[1] : "";
    }

    const summary = tag(b, "description") || tag(b, "summary") ||
      tag(b, "content");
    const published = (b.match(/<(?:pubDate|published|updated)>([\s\S]*?)</i) ??
      [])[1]?.trim();

    if (!title || !link) return [];
    return [{ title, link, summary, published }];
  });
}

async function markSource(patch: Record<string, unknown>) {
  await fetch(`${REST}/content_sources?id=eq.${SOURCE_ID}`, {
    method: "PATCH",
    headers: { ...restHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const srcRes = await fetch(
    `${REST}/content_sources?id=eq.${SOURCE_ID}&select=city_id,enabled,config`,
    { headers: restHeaders },
  );
  const [source] = await srcRes.json().catch(() => []);
  if (!source) return json({ error: "source not configured" }, 500);
  if (!source.enabled) return json({ ok: true, skipped: "source disabled" });

  const feeds: Feed[] = source.config?.feeds ?? [];
  if (!feeds.length) return json({ error: "no feeds configured" }, 500);

  /* Neighborhoods we actually serve — the filter that makes this hyperlocal
     rather than another city-wide feed reader. */
  const hoodRes = await fetch(
    `${REST}/postal_neighborhoods?city_id=eq.${source.city_id}&select=neighborhood`,
    { headers: restHeaders },
  );
  const hoodRows: { neighborhood: string }[] = await hoodRes.json()
    .catch(() => []);
  const hoods = [...new Set(hoodRows.map((h) => h.neighborhood))]
    /* Longest first so "East Village" wins over "Village". */
    .sort((a, b) => b.length - a.length);

  function findHood(text: string): string | null {
    const hay = text.toLowerCase();
    for (const h of hoods) {
      const needle = h.toLowerCase();
      const at = hay.indexOf(needle);
      if (at < 0) continue;
      /* Crude word boundaries — avoids matching inside a longer word. */
      const before = at === 0 ? " " : hay[at - 1];
      const after = hay[at + needle.length] ?? " ";
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
      return h;
    }
    return null;
  }

  /* Words that mean "this is the news", not "this is your week". Applied to
     every feed on top of whatever per-feed rules exist, because a story about
     a shooting on your block is still a story about your block — the
     neighborhood match can't tell the difference and shouldn't have to. */
  const globalDeny: string[] = source.config?.deny_words ?? [];

  function wanted(feed: Feed, entry: Entry): boolean {
    const path = (() => {
      try { return new URL(entry.link).pathname.toLowerCase(); }
      catch { return entry.link.toLowerCase(); }
    })();

    if (feed.allow_paths?.length &&
        !feed.allow_paths.some((p) => path.includes(p.toLowerCase()))) {
      return false;
    }
    if (feed.deny_paths?.some((p) => path.includes(p.toLowerCase()))) return false;

    const hay = ` ${entry.title.toLowerCase()} `;
    const deny = [...globalDeny, ...(feed.deny_words ?? [])];
    /* Padded match so "fire" doesn't reject "firehouse martini". */
    return !deny.some((w) => hay.includes(` ${w.toLowerCase()} `));
  }

  let fetched = 0;
  let noHood = 0;
  let filtered = 0;
  const items: Record<string, unknown>[] = [];
  const failures: string[] = [];

  for (const feed of feeds) {
    let xml: string;
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "HERESAY/1.0 (+https://itsallheresay.com)" },
      });
      if (!res.ok) { failures.push(`${feed.name}: HTTP ${res.status}`); continue; }
      xml = await res.text();
    } catch (err) {
      failures.push(`${feed.name}: ${String(err).slice(0, 80)}`);
      continue;
    }

    for (const entry of parseFeed(xml)) {
      fetched++;
      if (!wanted(feed, entry)) { filtered++; continue; }

      const hood = findHood(`${entry.title} ${entry.summary}`);
      if (!hood) { noHood++; continue; }

      const when = entry.published ? new Date(entry.published) : null;

      items.push({
        source_id: SOURCE_ID,
        external_id: entry.link.slice(0, 500),
        category: feed.category,
        title: entry.title.slice(0, 300),
        blurb: entry.summary.slice(0, 600) || null,
        url: entry.link,
        city_id: source.city_id,
        neighborhood: hood,
        starts_at: when && !isNaN(when.getTime()) ? when.toISOString() : null,
        raw: { feed: feed.name, ...entry },
      });
    }
  }

  if (!items.length) {
    await markSource({
      last_run_at: new Date().toISOString(),
      last_status: failures.length ? "partial" : "ok",
      last_error: failures.join("; ").slice(0, 400) || null,
      last_count: 0,
    });
    return json({
      ok: true, fetched, off_topic: filtered, no_neighborhood: noHood,
      upserted: 0, failures,
    });
  }

  /* Two feeds can carry the same story; keep one row per URL. */
  const unique = [...new Map(items.map((i) => [i.external_id, i])).values()];

  const up = await fetch(`${REST}/items?on_conflict=source_id,external_id`, {
    method: "POST",
    headers: {
      ...restHeaders,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(unique),
  });

  if (!up.ok) {
    const detail = (await up.text()).slice(0, 400);
    console.error("upsert failed", up.status, detail);
    await markSource({
      last_run_at: new Date().toISOString(),
      last_status: "error",
      last_error: `upsert ${up.status}: ${detail}`,
    });
    return json({ error: "could not store items" }, 500);
  }

  await markSource({
    last_run_at: new Date().toISOString(),
    last_status: failures.length ? "partial" : "ok",
    last_error: failures.join("; ").slice(0, 400) || null,
    last_count: unique.length,
  });

  return json({
    ok: true,
    fetched,
    off_topic: filtered,
    no_neighborhood: noHood,
    upserted: unique.length,
    failures,
  });
});
