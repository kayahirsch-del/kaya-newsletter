/* ===========================================================================
   GET /functions/v1/confirm?token=<confirm_token>

   Flips a pending subscriber to confirmed. Opened straight from an email
   client, so it must be publicly reachable and must render HTML, not JSON.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token = new URL(req.url).searchParams.get("token") ?? "";

  if (!UUID_RE.test(token)) {
    return page({
      kicker: "Hmm",
      title: "That link looks broken.",
      body: "Check that you copied the whole thing — or just sign up again and we'll send a fresh one.",
      status: 400,
    });
  }

  const res = await fetch(
    `${REST}?confirm_token=eq.${token}&status=eq.pending&select=first_name,neighborhood`,
    {
      method: "PATCH",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ status: "confirmed", confirmed_at: new Date().toISOString() }),
    },
  );

  if (!res.ok) {
    console.error("confirm failed", res.status, (await res.text()).slice(0, 300));
    return page({
      kicker: "Something broke",
      title: "That didn't go through.",
      body: "Try the link again in a minute. If it keeps failing, reply to the email and we'll sort it by hand.",
      status: 500,
    });
  }

  const [row] = await res.json();

  /* No row updated: either the token is unknown, or they already confirmed.
     Distinguish the two so a second click doesn't read as an error. */
  if (!row) {
    const check = await fetch(
      `${REST}?confirm_token=eq.${token}&select=first_name,neighborhood,status`,
      { headers: restHeaders },
    );
    const [known] = await check.json().catch(() => []);

    if (known?.status === "confirmed") {
      return page({
        kicker: "Already done",
        title: "You're confirmed.",
        body: `Nothing else to do — your ${known.neighborhood} issue is on its way.`,
      });
    }
    if (known?.status === "unsubscribed") {
      return page({
        kicker: "Heads up",
        title: "You've unsubscribed.",
        body: "This address opted out. Sign up again if that was a mistake.",
      });
    }
    return page({
      kicker: "Hmm",
      title: "We don't recognize that link.",
      body: "It may have already been used. Sign up again and we'll send a fresh one.",
      status: 404,
    });
  }

  return page({
    kicker: "Confirmed",
    title: `You're in, ${row.first_name}.`,
    body: `Your first ${row.neighborhood} issue lands Thursday morning. Add us to your contacts so it doesn't get filed under Promotions.`,
  });
});
