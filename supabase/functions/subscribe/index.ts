/* ===========================================================================
   POST /functions/v1/subscribe

   Takes the signup payload from the browser, writes the row with the
   service-role key, and sends the double opt-in email. The browser never
   touches the subscribers table directly, so the anon role holds no write
   grant of any kind.
   =========================================================================== */

import { BRAND, CORS, confirmEmail } from "../_shared/brand.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? `${BRAND} <onboarding@resend.dev>`;

const REST = `${SUPABASE_URL}/rest/v1/subscribers`;
const FUNCTIONS = `${SUPABASE_URL}/functions/v1`;

const CADENCES = ["weekly", "twice_weekly", "monthly"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const restHeaders = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/* Send via Resend. Never throws — a delivery failure must not cost us the
   signup that already committed. */
async function sendConfirmation(row: Record<string, string>) {
  if (!RESEND_KEY) {
    console.warn("RESEND_API_KEY unset — row saved, no email sent");
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  const { html, text } = confirmEmail({
    firstName: row.first_name,
    neighborhood: row.neighborhood,
    confirmUrl: `${FUNCTIONS}/confirm?token=${row.confirm_token}`,
    unsubscribeUrl: `${FUNCTIONS}/unsubscribe?token=${row.unsubscribe_token}`,
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [row.email],
        subject: `Confirm your ${BRAND} subscription`,
        html,
        text,
        headers: {
          "List-Unsubscribe": `<${FUNCTIONS}/unsubscribe?token=${row.unsubscribe_token}>`,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("resend failed", res.status, detail.slice(0, 400));
      return { sent: false, reason: `resend ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("resend threw", err);
    return { sent: false, reason: "network" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  /* ── validate, mirroring the client-side rules ────────────────────────── */
  const first_name = str(payload.first_name, 80);
  const email = str(payload.email, 254).toLowerCase();
  const city = str(payload.city, 80);
  const city_id = str(payload.city_id, 20);
  const neighborhood = str(payload.neighborhood, 80);
  const street_address = str(payload.street_address, 160) || null;
  const cadence = CADENCES.includes(String(payload.cadence))
    ? String(payload.cadence)
    : "weekly";

  const interests = Array.isArray(payload.interests)
    ? [...new Set(payload.interests.filter((i) => typeof i === "string").map((i) => str(i, 40)))]
      .filter(Boolean).slice(0, 20)
    : [];

  const missing: string[] = [];
  if (!first_name) missing.push("first_name");
  if (!EMAIL_RE.test(email)) missing.push("email");
  if (!city || !city_id) missing.push("city");
  if (!neighborhood) missing.push("neighborhood");
  if (!interests.length) missing.push("interests");

  if (missing.length) return json({ error: "invalid fields", fields: missing }, 400);

  /* ── insert ───────────────────────────────────────────────────────────── */
  const insert = await fetch(REST, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      first_name, email, city, city_id, neighborhood,
      street_address, interests, cadence, source: "web",
    }),
  });

  if (insert.status === 409) {
    /* Already on the list. If they never confirmed, resend the email rather
       than leaving them stuck — otherwise say so and send nothing. */
    const lookup = await fetch(
      `${REST}?email=eq.${encodeURIComponent(email)}&select=first_name,email,neighborhood,status,confirm_token,unsubscribe_token`,
      { headers: restHeaders },
    );
    const [existing] = await lookup.json().catch(() => []);

    if (existing?.status === "pending") {
      await sendConfirmation(existing);
      return json({ ok: true, duplicate: true, resent: true });
    }
    return json({ ok: true, duplicate: true, resent: false });
  }

  if (!insert.ok) {
    const detail = await insert.text();
    console.error("insert failed", insert.status, detail.slice(0, 400));
    return json({ error: "could not save subscription" }, 500);
  }

  const [row] = await insert.json();
  const delivery = await sendConfirmation(row);

  return json({ ok: true, duplicate: false, emailed: delivery.sent });
});
