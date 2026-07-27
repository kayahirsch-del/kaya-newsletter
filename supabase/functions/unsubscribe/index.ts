/* ===========================================================================
   /functions/v1/unsubscribe?token=<unsubscribe_token>

   GET  — renders a one-button confirmation page.
   POST — performs the unsubscribe.

   The split is deliberate. Corporate mail scanners and link-preview bots
   fetch every URL in an inbound email; if GET did the write, those prefetches
   would silently unsubscribe people who never clicked. POST also satisfies
   RFC 8058 one-click, so a mail client's native "unsubscribe" still works in
   a single step.
   =========================================================================== */

import { CORS, page } from "../_shared/brand.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1/subscribers`;

const restHeaders = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const badLink = () =>
  page({
    kicker: "Hmm",
    title: "That link looks broken.",
    body: "Check that you copied the whole thing, or reply to any issue and we'll remove you by hand.",
    status: 400,
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!UUID_RE.test(token)) return badLink();

  /* ── GET: ask first, so bots crawling the link change nothing ─────────── */
  if (req.method === "GET") {
    const look = await fetch(
      `${REST}?unsubscribe_token=eq.${token}&select=first_name,status`,
      { headers: restHeaders },
    );
    const [row] = await look.json().catch(() => []);

    if (!row) return badLink();

    if (row.status === "unsubscribed") {
      return page({
        kicker: "Already done",
        title: "You're unsubscribed.",
        body: "We won't email you again. Nothing else to do.",
      });
    }

    return page({
      kicker: "Before you go",
      title: "Unsubscribe from SPOTTED?",
      body: "You'll stop getting issues immediately. You can always sign up again.",
      action: { url: `${url.origin}${url.pathname}?token=${token}`, label: "Yes, unsubscribe me" },
    });
  }

  if (req.method !== "POST") return badLink();

  /* ── POST: do it ──────────────────────────────────────────────────────── */
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
    return page({
      kicker: "Something broke",
      title: "That didn't go through.",
      body: "Try again in a minute, or reply to any issue and we'll remove you by hand.",
      status: 500,
    });
  }

  const [row] = await res.json();
  if (!row) return badLink();

  return page({
    kicker: "Done",
    title: "You're unsubscribed.",
    body: "No hard feelings. If you change your mind, the signup page is always open.",
  });
});
