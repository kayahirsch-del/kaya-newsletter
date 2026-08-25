/* ===========================================================================
   POST /functions/v1/send-issue
     { token, issue_id? | send_on?, city_id?, test_to?, confirm? }

   Sends a built issue. `build-issue` decided who gets what; this renders and
   delivers it.

   Two modes, and the difference is deliberate:

     test_to   Renders every queued subscriber's issue and sends all of them
               to one address. Nothing is recorded, nothing is marked
               published, no real subscriber is touched. This is how you look
               at an issue before anyone else does.

     confirm   The real send. Requires `confirm: true` in the body — there is
               no way to mail the list by fat-fingering a request. Marks each
               row sent as it goes, so an interrupted run resumes without
               double-mailing, and moves used items to `published` so they
               don't come round again.

   Every message carries List-Unsubscribe and List-Unsubscribe-Post, and a
   per-subscriber unsubscribe link — the same token the confirm flow issues.
   =========================================================================== */

import { CORS, json, SITE_URL } from "../_shared/brand.ts";
import { issueEmail, type IssueItem } from "../_shared/issue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "onboarding@resend.dev";

/* FROM_EMAIL may be a bare address or already carry a display name. Wrapping
   one that's already wrapped yields `HERESAY <HERESAY <hello@…>>`, which
   Resend rejects with a 422 — which is exactly what the first test send did. */
const FROM = FROM_EMAIL.includes("<") ? FROM_EMAIL : `HERESAY <${FROM_EMAIL}>`;
const REPLY_TO = Deno.env.get("REPLY_TO");
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

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

type Plan = {
  subscriber_id: string;
  item_ids: string[];
  status: string;
  subscribers: {
    first_name: string | null;
    email: string;
    neighborhood: string | null;
    unsubscribe_token: string;
  };
};

async function sendOne(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
      /* RFC 8058: lets a mail client's native unsubscribe button work in one
         click, which mailbox providers increasingly require of bulk senders. */
      headers: {
        "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });

  if (res.ok) return { ok: true };
  return { ok: false, error: (await res.text()).slice(0, 300) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!ADMIN_TOKEN) return json({ error: "not configured" }, 503);
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY unset — cannot send");
    return json({ error: "email is not configured" }, 503);
  }

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "invalid JSON" }, 400);
  if (!tokenOk(body.token)) return json({ error: "unauthorized" }, 401);

  const testTo = body.test_to ? String(body.test_to) : null;
  const cityId = String(body.city_id ?? "nyc");

  /* ── find the issue ───────────────────────────────────────────────────── */
  const filter = body.issue_id
    ? { id: `eq.${String(body.issue_id)}` }
    : {
      city_id: `eq.${cityId}`,
      send_on: `eq.${String(body.send_on ?? new Date().toISOString().slice(0, 10))}`,
    };

  const issueRes = await fetch(
    `${REST}/issues?${q({ ...filter, select: "*" })}`,
    { headers: restHeaders },
  );
  const [issue] = await issueRes.json().catch(() => []);
  if (!issue) return json({ error: "no such issue" }, 404);

  /* A real send happens once. A test can be repeated all day. */
  if (!testTo) {
    if (issue.status === "sent") {
      return json({ error: "already sent", issue_id: issue.id }, 409);
    }
    if (body.confirm !== true) {
      return json({
        error: "refusing to mail the list without confirm: true",
        issue_id: issue.id,
        hint: "send with test_to first, then confirm",
      }, 400);
    }
  }

  const cityRes = await fetch(
    `${REST}/cities?${q({ id: `eq.${issue.city_id}`, select: "timezone" })}`,
    { headers: restHeaders },
  );
  const [city] = await cityRes.json().catch(() => []);
  const timezone = city?.timezone ?? "America/New_York";

  /* ── the plan ─────────────────────────────────────────────────────────── */
  const plansRes = await fetch(
    `${REST}/issue_sends?${q({
      issue_id: `eq.${issue.id}`,
      status: "eq.queued",
      select:
        "subscriber_id,item_ids,status,subscribers(first_name,email,neighborhood,unsubscribe_token)",
    })}`,
    { headers: restHeaders },
  );
  const plans: Plan[] = await plansRes.json().catch(() => []);
  if (!plans.length) {
    return json({ ok: true, sent: 0, note: "nothing queued for this issue" });
  }

  /* Every item referenced across the whole plan, fetched once. */
  const allIds = [...new Set(plans.flatMap((p) => p.item_ids))];
  const itemsRes = await fetch(
    `${REST}/items?${q({
      id: `in.(${allIds.join(",")})`,
      select:
        "id,title,blurb,url,address,venue_name,neighborhood,category,starts_at,ends_at",
    })}`,
    { headers: restHeaders },
  );
  const itemRows: IssueItem[] = await itemsRes.json().catch(() => []);
  const byId = new Map(itemRows.map((i) => [i.id, i]));

  if (!testTo) {
    await fetch(`${REST}/issues?id=eq.${issue.id}`, {
      method: "PATCH",
      headers: { ...restHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "sending" }),
    });
  }

  let sent = 0;
  const failures: string[] = [];

  for (const plan of plans) {
    const sub = plan.subscribers;
    if (!sub?.email) continue;

    const hood = sub.neighborhood ?? "your neighborhood";
    const items = plan.item_ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((i) => ({
        ...i!,
        /* Anything not in this person's own neighborhood is a top-up, and
           the template files it under "Worth the trip" rather than implying
           it's local. */
        citywide: (i!.neighborhood ?? "").toLowerCase() !== hood.toLowerCase(),
      }));

    if (!items.length) continue;

    const unsubscribeUrl =
      `${SUPABASE_URL}/functions/v1/unsubscribe?token=${sub.unsubscribe_token}`;

    const { subject, html, text } = issueEmail({
      firstName: sub.first_name || "there",
      neighborhood: hood,
      items,
      intro: issue.intro,
      unsubscribeUrl,
      timezone,
    });

    const delivery = await sendOne({
      to: testTo ?? sub.email,
      subject: testTo ? `[TEST → ${sub.email}] ${subject}` : subject,
      html,
      text,
      unsubscribeUrl,
    });

    if (delivery.ok) {
      sent++;
      if (!testTo) {
        await fetch(
          `${REST}/issue_sends?${q({
            issue_id: `eq.${issue.id}`,
            subscriber_id: `eq.${plan.subscriber_id}`,
          })}`,
          {
            method: "PATCH",
            headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({
              status: "sent",
              sent_at: new Date().toISOString(),
            }),
          },
        );
      }
    } else {
      failures.push(`${sub.email}: ${delivery.error}`);
      console.error("send failed", sub.email, delivery.error);
      if (!testTo) {
        await fetch(
          `${REST}/issue_sends?${q({
            issue_id: `eq.${issue.id}`,
            subscriber_id: `eq.${plan.subscriber_id}`,
          })}`,
          {
            method: "PATCH",
            headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ status: "failed", error: delivery.error }),
          },
        );
      }
    }

    /* Resend's default rate limit is 2 requests a second. At list sizes this
       small the pause costs nothing and removes a whole class of flake. */
    await new Promise((r) => setTimeout(r, 600));
  }

  if (testTo) {
    return json({ ok: true, test: true, to: testTo, rendered: sent, failures });
  }

  /* Items that actually went out are done — they shouldn't reappear in a
     later issue for anyone. */
  const published = [...new Set(plans.flatMap((p) => p.item_ids))];
  if (published.length) {
    await fetch(`${REST}/items?${q({ id: `in.(${published.join(",")})` })}`, {
      method: "PATCH",
      headers: { ...restHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "published" }),
    });
  }

  await fetch(`${REST}/issues?id=eq.${issue.id}`, {
    method: "PATCH",
    headers: { ...restHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({
      status: failures.length && !sent ? "ready" : "sent",
      sent_at: new Date().toISOString(),
    }),
  });

  console.log(`issue ${issue.id}: sent ${sent}/${plans.length}`);

  return json({
    ok: true,
    issue_id: issue.id,
    sent,
    queued: plans.length,
    published: published.length,
    failures,
  });
});
