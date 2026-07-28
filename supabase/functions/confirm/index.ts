/* ===========================================================================
   GET /functions/v1/confirm?token=<confirm_token>

   Flips a pending subscriber to confirmed, then redirects to /confirmed on
   the static site. The page can't be rendered here: Supabase forces
   text/plain plus a sandbox CSP on edge function responses.
   =========================================================================== */

import { CORS, redirect } from "../_shared/brand.ts";

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
  if (!UUID_RE.test(token)) return redirect("/confirmed", { state: "invalid" });

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
    return redirect("/confirmed", { state: "invalid" });
  }

  const [row] = await res.json();

  /* No row updated: either an unknown token, or they already confirmed.
     Distinguish the two so a second click doesn't read as an error. */
  if (!row) {
    const check = await fetch(
      `${REST}?confirm_token=eq.${token}&select=first_name,neighborhood,status`,
      { headers: restHeaders },
    );
    const [known] = await check.json().catch(() => []);

    if (known?.status === "confirmed") {
      return redirect("/confirmed", { state: "already", hood: known.neighborhood });
    }
    if (known?.status === "unsubscribed") {
      return redirect("/confirmed", { state: "unsubscribed" });
    }
    return redirect("/confirmed", { state: "invalid" });
  }

  return redirect("/confirmed", {
    state: "confirmed",
    name: row.first_name,
    hood: row.neighborhood,
  });
});
