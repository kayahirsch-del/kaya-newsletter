/* ===========================================================================
   /functions/v1/unsubscribe?token=<unsubscribe_token>

   GET  — redirects to /unsubscribe on the static site, which renders the
          confirmation button. No write.
   POST — performs the unsubscribe and returns JSON.

   The split is deliberate. Corporate mail scanners and link-preview bots
   fetch every URL in an inbound email; if GET did the write, those prefetches
   would silently unsubscribe people who never clicked. POST also satisfies
   RFC 8058 one-click, so a mail client's native unsubscribe still works in
   a single step.
   =========================================================================== */

import { CORS, json, redirect } from "../_shared/brand.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1/subscribers`;

const restHeaders = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  /* Hand the browser to the static page, which owns the confirm button. */
  if (req.method === "GET") return redirect("/unsubscribe", { token });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!UUID_RE.test(token)) return json({ error: "invalid token" }, 400);

  /* Already opted out? Report it as its own state rather than an error, so a
     repeat click reads as "already done" instead of failing. */
  const look = await fetch(
    `${REST}?unsubscribe_token=eq.${token}&select=status`,
    { headers: restHeaders },
  );
  const [existing] = await look.json().catch(() => []);

  if (!existing) return json({ error: "unknown token" }, 404);
  if (existing.status === "unsubscribed") return json({ ok: false, already: true });

  const res = await fetch(
    `${REST}?unsubscribe_token=eq.${token}&select=first_name`,
    {
      method: "PATCH",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        status: "unsubscribed",
        unsubscribed_at: new Date().toISOString(),
      }),
    },
  );

  if (!res.ok) {
    console.error("unsubscribe failed", res.status, (await res.text()).slice(0, 300));
    return json({ error: "could not unsubscribe" }, 500);
  }

  const [row] = await res.json();
  if (!row) return json({ error: "unknown token" }, 404);

  return json({ ok: true });
});
