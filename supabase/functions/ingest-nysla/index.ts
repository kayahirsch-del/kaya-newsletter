/* ===========================================================================
   POST /functions/v1/ingest-nysla

   Pulls newly issued NY State Liquor Authority licenses and files them as
   candidates in `items`.

   Why this source: a liquor licence is issued before a place opens its doors,
   so it surfaces bars and restaurants weeks ahead of any listings site. It is
   public record, free, structured, and geocoded.

   What it is not: a clean "new venue" feed. The dataset is *current active
   licences*, so a renewal or a class change at a long-established venue also
   gets a fresh issue date. Everything here lands as `status = 'new'` for a
   human to approve — precision is the editor's job, recall is this function's.
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

const SOURCE_ID = "nysla";

type Row = {
  licensepermitid?: string;
  dba?: string;
  legalname?: string;
  description?: string;
  actualaddressofpremises?: string;
  city?: string;
  zipcode?: string;
  originalissuedate?: string;
  georeference?: { type: string; coordinates: [number, number] };
};

/* The feed shouts. "FRESH GARDEN SUPERMARKET INC." reads better as
   "Fresh Garden Supermarket Inc." Leaves mixed-case names alone, since those
   are already how the owner writes them. */
function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llc|Inc|Corp|Nyc)\b/g, (m) => m.toUpperCase());
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

  /* ── config ───────────────────────────────────────────────────────────── */
  const srcRes = await fetch(
    `${REST}/content_sources?id=eq.${SOURCE_ID}&select=city_id,category,enabled,config`,
    { headers: restHeaders },
  );
  const [source] = await srcRes.json().catch(() => []);
  if (!source) return json({ error: "source not configured" }, 500);
  if (!source.enabled) return json({ ok: true, skipped: "source disabled" });

  const cfg = source.config ?? {};
  const dataset: string = cfg.dataset ?? "9s3h-dpkz";
  const counties: string[] = cfg.counties ?? ["NEW YORK"];
  const lookback: number = Number(cfg.lookback_days ?? 30);
  const keep: string[] = (cfg.keep_descriptions ?? []).map((d: string) =>
    d.toLowerCase()
  );

  const since = new Date(Date.now() - lookback * 864e5)
    .toISOString().slice(0, 19);

  /* Socrata is case-inconsistent on county ("Bronx" vs "ALBANY"), so compare
     upper-cased on both sides. */
  const countyList = counties.map((c) => `'${c.replace(/'/g, "''")}'`).join(",");
  const where =
    `upper(premisescounty) IN (${countyList}) AND originalissuedate > '${since}'`;

  const url = `https://data.ny.gov/resource/${dataset}.json` +
    `?$select=licensepermitid,dba,legalname,description,` +
    `actualaddressofpremises,city,zipcode,originalissuedate,georeference` +
    `&$where=${encodeURIComponent(where)}` +
    `&$order=originalissuedate DESC&$limit=1000`;

  /* ── fetch ────────────────────────────────────────────────────────────── */
  let rows: Row[];
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      await markSource({
        last_run_at: new Date().toISOString(),
        last_status: "error",
        last_error: `socrata ${res.status}: ${detail}`,
      });
      return json({ error: "source fetch failed", status: res.status }, 502);
    }
    rows = await res.json();
  } catch (err) {
    await markSource({
      last_run_at: new Date().toISOString(),
      last_status: "error",
      last_error: String(err).slice(0, 300),
    });
    return json({ error: "source unreachable" }, 502);
  }

  /* ── postal code → neighborhood ───────────────────────────────────────── */
  const zipRes = await fetch(
    `${REST}/postal_neighborhoods?city_id=eq.${source.city_id}&select=postal_code,neighborhood`,
    { headers: restHeaders },
  );
  const zips: { postal_code: string; neighborhood: string }[] =
    await zipRes.json().catch(() => []);
  const hoodByZip = new Map(zips.map((z) => [z.postal_code, z.neighborhood]));

  /* ── shape ────────────────────────────────────────────────────────────── */
  let filtered = 0;
  const items = rows.flatMap((r) => {
    const desc = (r.description ?? "").toLowerCase();
    if (keep.length && !keep.includes(desc)) { filtered++; return []; }
    if (!r.licensepermitid) return [];

    const name = tidyName(r.dba || r.legalname || "");
    if (!name) return [];

    const zip = (r.zipcode ?? "").slice(0, 5);
    const coords = r.georeference?.coordinates;   // Socrata gives [lng, lat]

    return [{
      source_id: SOURCE_ID,
      external_id: r.licensepermitid,
      category: source.category,
      title: name,
      blurb: `${r.description ?? "Licence"} issued ${
        (r.originalissuedate ?? "").slice(0, 10)
      } — ${r.actualaddressofpremises ?? "address unknown"}`,
      url: `https://data.ny.gov/resource/${dataset}.json?licensepermitid=${
        encodeURIComponent(r.licensepermitid)
      }`,
      venue_name: name,
      address: r.actualaddressofpremises ?? null,
      postal_code: zip || null,
      city_id: source.city_id,
      neighborhood: hoodByZip.get(zip) ?? null,
      lng: coords?.[0] ?? null,
      lat: coords?.[1] ?? null,
      starts_at: r.originalissuedate ? `${r.originalissuedate}Z` : null,
      raw: r,
    }];
  });

  if (!items.length) {
    await markSource({
      last_run_at: new Date().toISOString(),
      last_status: "ok",
      last_error: null,
      last_count: 0,
    });
    return json({ ok: true, fetched: rows.length, filtered, upserted: 0 });
  }

  /* ── upsert ───────────────────────────────────────────────────────────── */
  /* merge-duplicates so a re-run updates rather than 409s. Editor decisions
     live in `status`, which is absent from the payload and so is preserved. */
  const up = await fetch(`${REST}/items?on_conflict=source_id,external_id`, {
    method: "POST",
    headers: {
      ...restHeaders,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(items),
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
    last_status: "ok",
    last_error: null,
    last_count: items.length,
  });

  return json({
    ok: true,
    fetched: rows.length,
    filtered_out: filtered,
    upserted: items.length,
  });
});
