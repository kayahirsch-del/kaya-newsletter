/* ===========================================================================
   POST /functions/v1/build-issue   { token, city_id?, send_on?, force? }

   Assembles a draft issue: which approved items each confirmed subscriber
   would receive. Writes nothing to anyone's inbox — that's `send-issue`.

   Splitting build from send is the point. An issue you can look at before it
   goes is an issue you can stop, and the failure mode this guards against is
   mailing four people a thin list of liquor licences.

   What it does per subscriber
   ---------------------------
   1. Items in their own neighborhood, newest first, capped at max_items.
   2. If that's under min_items and citywide_fallback is on, top up from the
      rest of the city — filed under "Worth the trip", never presented as
      local.
   3. Never an item they've already been sent, in any past issue.
   4. Only beats they asked for: interests map onto categories.
   5. Still under min_items → they're skipped with a reason, not sent a
      near-empty email. An empty newsletter teaches people to ignore you.

   Re-running for the same date rebuilds the draft in place. Once an issue is
   `sending` or `sent` it is frozen, unless you pass force.
   =========================================================================== */

import { CORS, json } from "../_shared/brand.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN");
const REST = `${SUPABASE_URL}/rest/v1`;

const restHeaders = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

function tokenOk(given: unknown): boolean {
  if (!ADMIN_TOKEN || typeof given !== "string") return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(ADMIN_TOKEN);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/* The signup form's interest chips, mapped onto the beats items are filed
   under. Someone who only ticked "sample_sales" should not be sent
   restaurants just because that's what we happen to have. */
const INTEREST_TO_CATEGORY: Record<string, string> = {
  restaurants: "table",
  nightlife: "table",
  concerts: "lineup",
  events: "lineup",
  art: "lineup",
  fitness: "lineup",
  sample_sales: "haul",
  shopping: "haul",
  vintage: "haul",
  beauty: "haul",
};

type Item = {
  id: string;
  category: string;
  neighborhood: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

type Subscriber = {
  id: string;
  neighborhood: string | null;
  interests: string[] | null;
  city_id: string;
};

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN unset — refusing every request");
    return json({ error: "not configured" }, 503);
  }

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "invalid JSON" }, 400);
  if (!tokenOk(body.token)) return json({ error: "unauthorized" }, 401);

  const cityId = String(body.city_id ?? "nyc");
  const sendOn = String(body.send_on ?? new Date().toISOString().slice(0, 10));

  /* ── city config ──────────────────────────────────────────────────────── */
  const cityRes = await fetch(
    `${REST}/cities?${q({ id: `eq.${cityId}`, select: "id,timezone,enabled,newsletter" })}`,
    { headers: restHeaders },
  );
  const [city] = await cityRes.json().catch(() => []);
  if (!city) return json({ error: `unknown city ${cityId}` }, 400);

  const cfg = city.newsletter ?? {};
  const minItems = Number(cfg.min_items ?? 3);
  const maxItems = Number(cfg.max_items ?? 8);
  const citywideFallback = cfg.citywide_fallback !== false;

  /* ── the issue row ────────────────────────────────────────────────────── */
  const existingRes = await fetch(
    `${REST}/issues?${q({ city_id: `eq.${cityId}`, send_on: `eq.${sendOn}`, select: "*" })}`,
    { headers: restHeaders },
  );
  const [existing] = await existingRes.json().catch(() => []);

  if (existing && ["sending", "sent"].includes(existing.status) && !body.force) {
    return json({
      error: `issue for ${sendOn} is already ${existing.status}`,
      issue_id: existing.id,
    }, 409);
  }

  let issueId: string;
  if (existing) {
    issueId = existing.id;
    /* Rebuild in place: clear the previous plan so a re-run reflects
       whatever the editor has approved since. */
    await fetch(`${REST}/issue_sends?issue_id=eq.${issueId}`, {
      method: "DELETE",
      headers: restHeaders,
    });
    await fetch(`${REST}/issue_items?issue_id=eq.${issueId}`, {
      method: "DELETE",
      headers: restHeaders,
    });
  } else {
    const mk = await fetch(`${REST}/issues`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ city_id: cityId, send_on: sendOn, status: "draft" }),
    });
    if (!mk.ok) {
      console.error("create issue failed", mk.status, (await mk.text()).slice(0, 300));
      return json({ error: "could not create issue" }, 500);
    }
    issueId = (await mk.json())[0].id;
  }

  /* ── the pool ─────────────────────────────────────────────────────────── */
  const itemsRes = await fetch(
    `${REST}/items?${q({
      city_id: `eq.${cityId}`,
      status: "eq.approved",
      select: "id,category,neighborhood,starts_at,ends_at,created_at",
      order: "starts_at.asc.nullslast,created_at.desc",
      limit: "500",
    })}`,
    { headers: restHeaders },
  );
  const pool: Item[] = await itemsRes.json().catch(() => []);

  /* What counts as expired depends on the beat, and getting this wrong is
     easy: `starts_at` does not mean the same thing everywhere.

     For a sample sale or a show it's when the thing happens, so a past date
     means it's over and printing it is worse than printing nothing. For a
     restaurant it's the date the liquor licence was issued — "this place
     just appeared", which is the entire reason it's a candidate. Filtering
     those on `starts_at` threw out all 20 approved items on the first run.

     So: an item is dead when its last day has passed. Only things that
     actually run on dates have a last day. */
  const cutoff = Date.now() - 86_400_000;
  const expires = (i: Item) => i.category === "haul" || i.category === "lineup";

  const live = pool.filter((i) => {
    const last = i.ends_at ?? (expires(i) ? i.starts_at : null);
    return !last || new Date(last).getTime() >= cutoff;
  });

  /* ── who's getting it ─────────────────────────────────────────────────── */
  const subsRes = await fetch(
    `${REST}/subscribers?${q({
      status: "eq.confirmed",
      city_id: `eq.${cityId}`,
      select: "id,neighborhood,interests,city_id",
    })}`,
    { headers: restHeaders },
  );
  const subs: Subscriber[] = await subsRes.json().catch(() => []);

  /* Everything each person has ever been sent, so nothing repeats. One query
     rather than one per subscriber. */
  const seenRes = await fetch(
    `${REST}/issue_sends?${q({ select: "subscriber_id,item_ids", status: "eq.sent" })}`,
    { headers: restHeaders },
  );
  const seenRows: { subscriber_id: string; item_ids: string[] }[] =
    await seenRes.json().catch(() => []);
  const seen = new Map<string, Set<string>>();
  for (const r of seenRows) {
    const set = seen.get(r.subscriber_id) ?? new Set<string>();
    (r.item_ids ?? []).forEach((id) => set.add(id));
    seen.set(r.subscriber_id, set);
  }

  const plans: Record<string, unknown>[] = [];
  const used = new Set<string>();
  const summary: Record<string, unknown>[] = [];

  for (const sub of subs) {
    const already = seen.get(sub.id) ?? new Set<string>();

    /* No interests recorded means no filter, not no items. */
    const wanted = new Set(
      (sub.interests ?? [])
        .map((i) => INTEREST_TO_CATEGORY[i])
        .filter(Boolean),
    );
    const matchesInterest = (i: Item) =>
      wanted.size === 0 || wanted.has(i.category) || i.category === "other";

    const eligible = live.filter((i) => !already.has(i.id) && matchesInterest(i));

    const hood = (sub.neighborhood ?? "").toLowerCase();
    const local = eligible
      .filter((i) => (i.neighborhood ?? "").toLowerCase() === hood)
      .slice(0, maxItems);

    let chosen = local;
    let fallbackCount = 0;

    if (chosen.length < minItems && citywideFallback) {
      const rest = eligible
        .filter((i) => (i.neighborhood ?? "").toLowerCase() !== hood)
        .slice(0, maxItems - chosen.length);
      fallbackCount = rest.length;
      chosen = [...chosen, ...rest];
    }

    const enough = chosen.length >= minItems;

    plans.push({
      issue_id: issueId,
      subscriber_id: sub.id,
      item_ids: enough ? chosen.map((i) => i.id) : [],
      status: enough ? "queued" : "skipped",
      reason: enough
        ? null
        : `thin: ${chosen.length} item${chosen.length === 1 ? "" : "s"}, need ${minItems}`,
    });

    if (enough) chosen.forEach((i) => used.add(i.id));

    summary.push({
      neighborhood: sub.neighborhood,
      local: local.length,
      citywide: fallbackCount,
      total: enough ? chosen.length : 0,
      status: enough ? "queued" : "skipped",
    });
  }

  if (plans.length) {
    const w = await fetch(`${REST}/issue_sends`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "return=minimal" },
      body: JSON.stringify(plans),
    });
    if (!w.ok) {
      console.error("write plans failed", w.status, (await w.text()).slice(0, 300));
      return json({ error: "could not write the plan" }, 500);
    }
  }

  if (used.size) {
    await fetch(`${REST}/issue_items`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(
        [...used].map((item_id) => ({ issue_id: issueId, item_id })),
      ),
    });
  }

  const queued = plans.filter((p) => p.status === "queued").length;

  /* Deliberately left as `draft`. Only a human moves an issue to `ready`,
     and only `send-issue` moves it past that. */

  console.log(
    `issue ${issueId} ${sendOn}: ${queued}/${subs.length} queued, ${used.size} items`,
  );

  return json({
    ok: true,
    issue_id: issueId,
    send_on: sendOn,
    subscribers: subs.length,
    queued,
    skipped: subs.length - queued,
    distinct_items: used.size,
    pool: { approved: pool.length, live: live.length },
    per_subscriber: summary,
  });
});
