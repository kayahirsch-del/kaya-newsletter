/* ===========================================================================
   POST /functions/v1/review

   Back-office API for triaging the candidate pool. Two actions:

     { action: "list",   token, city_id?, status?, neighborhood?, q?, limit?, offset? }
     { action: "update", token, ids: [...], status?, notes? }

   Auth is a single shared secret in the ADMIN_TOKEN secret. That is a
   deliberate choice for a one-person internal tool, not a claim of real
   security: anyone holding the token can read and re-status every item. It is
   scoped to `items` only — this function can never reach `subscribers`. Move
   to Supabase Auth before a second person needs access.

   Fails closed: with ADMIN_TOKEN unset, every request is rejected.
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

const STATUSES = ["new", "approved", "rejected", "published"];

/* Length-independent compare, so a wrong token leaks nothing through timing. */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN unset — refusing every request");
    return json({ error: "review is not configured" }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  if (!tokenOk(body.token)) return json({ error: "unauthorized" }, 401);

  /* ── list ─────────────────────────────────────────────────────────────── */
  if (body.action === "list") {
    const status = STATUSES.includes(String(body.status))
      ? String(body.status)
      : "new";
    const cityId = String(body.city_id ?? "nyc");
    const limit = Math.min(Number(body.limit ?? 50), 200);
    const offset = Math.max(Number(body.offset ?? 0), 0);

    const params = new URLSearchParams({
      select:
        "id,title,blurb,address,neighborhood,postal_code,category,source_id," +
        "url,starts_at,status,notes,created_at",
      city_id: `eq.${cityId}`,
      status: `eq.${status}`,
      order: "starts_at.desc.nullslast,created_at.desc",
      limit: String(limit),
      offset: String(offset),
    });

    if (body.neighborhood) {
      params.set("neighborhood", `eq.${String(body.neighborhood)}`);
    }
    if (body.q) {
      /* Match the free-text box against name or street. */
      const q = String(body.q).replace(/[,()*]/g, " ").trim();
      if (q) params.set("or", `(title.ilike.*${q}*,address.ilike.*${q}*)`);
    }

    const res = await fetch(`${REST}/items?${params}`, {
      headers: { ...restHeaders, Prefer: "count=exact" },
    });
    if (!res.ok) {
      console.error("list failed", res.status, (await res.text()).slice(0, 300));
      return json({ error: "could not load items" }, 500);
    }

    const items = await res.json();
    /* content-range comes back as "0-49/406" */
    const total = Number(
      (res.headers.get("content-range") ?? "").split("/")[1] ?? items.length,
    );

    /* Counts per status, so the tabs can show numbers. */
    const counts: Record<string, number> = {};
    await Promise.all(STATUSES.map(async (s) => {
      const r = await fetch(
        `${REST}/items?select=id&city_id=eq.${cityId}&status=eq.${s}&limit=1`,
        { headers: { ...restHeaders, Prefer: "count=exact" } },
      );
      counts[s] = Number(
        (r.headers.get("content-range") ?? "").split("/")[1] ?? 0,
      );
    }));

    /* Neighborhoods present in this city, for the filter dropdown. */
    const hoodRes = await fetch(
      `${REST}/items?select=neighborhood&city_id=eq.${cityId}&neighborhood=not.is.null`,
      { headers: restHeaders },
    );
    const hoodRows: { neighborhood: string }[] = await hoodRes.json()
      .catch(() => []);
    const neighborhoods = [...new Set(hoodRows.map((h) => h.neighborhood))]
      .sort();

    return json({ ok: true, items, total, counts, neighborhoods });
  }

  /* ── update ───────────────────────────────────────────────────────────── */
  if (body.action === "update") {
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((i) => typeof i === "string").slice(0, 200)
      : [];
    if (!ids.length) return json({ error: "no ids given" }, 400);

    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (!STATUSES.includes(String(body.status))) {
        return json({ error: "unknown status" }, 400);
      }
      patch.status = String(body.status);
    }
    if (body.notes !== undefined) {
      patch.notes = String(body.notes).slice(0, 2000) || null;
    }
    if (!Object.keys(patch).length) return json({ error: "nothing to change" }, 400);

    const inList = ids.map((i) => `"${i}"`).join(",");
    const res = await fetch(`${REST}/items?id=in.(${inList})&select=id`, {
      method: "PATCH",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });

    if (!res.ok) {
      console.error("update failed", res.status, (await res.text()).slice(0, 300));
      return json({ error: "could not update" }, 500);
    }

    const changed = await res.json();
    return json({ ok: true, updated: changed.length });
  }

  return json({ error: "unknown action" }, 400);
});
