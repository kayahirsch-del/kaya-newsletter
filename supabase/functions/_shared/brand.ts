/* Shared brand chrome for HERESAY's transactional email.

   Note there is no HTML-page helper here on purpose. Supabase's gateway
   rewrites every edge function response to `Content-Type: text/plain` and
   attaches `content-security-policy: default-src 'none'; sandbox`, so a
   browser will never render markup served from *.supabase.co — it shows the
   source as text instead. User-facing pages therefore live on the static
   site, and these functions redirect to them. */

export const BRAND = "HERESAY";

const PAPER = "#FAF3EA";
const INK = "#14100E";
const INK_2 = "#453B34";
const POP = "#E11D5C";
const LINE = "#DFCDB8";

const SERIF = `"Bodoni Moda", Didot, "Didot LT STD", "Hoefler Text", Georgia, serif`;
const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/* Where the static pages live, e.g. https://heresay.com */
export const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");

/* 302 to a page on the static site. When SITE_URL isn't configured we can't
   redirect anywhere useful, so fall back to plain text — which is the only
   thing the gateway will render from this origin anyway. */
export function redirect(path: string, params: Record<string, string> = {}) {
  if (!SITE_URL) {
    console.warn("SITE_URL unset — cannot redirect to the static site");
    return new Response(
      "Done. Head back to the site — SITE_URL is not configured on this function.",
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } },
    );
  }

  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v),
  ).toString();

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${SITE_URL}${path}${qs ? "?" + qs : ""}`,
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

/* ── confirmation email ─────────────────────────────────────────────────── */

export function confirmEmail(opts: {
  firstName: string;
  neighborhood: string;
  confirmUrl: string;
  unsubscribeUrl: string;
}) {
  const { firstName, neighborhood, confirmUrl, unsubscribeUrl } = opts;

  const text = [
    `One more tap and you're in.`,
    ``,
    `Hi ${firstName} — confirm your subscription to ${BRAND} and your first`,
    `${neighborhood} issue is on its way.`,
    ``,
    `Confirm: ${confirmUrl}`,
    ``,
    `If you didn't sign up, ignore this and nothing happens.`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Confirm your ${BRAND} subscription</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td align="center" style="padding:36px 16px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">

  <tr><td style="background:${INK};padding:14px 24px;">
    <span style="font-family:${SERIF};font-size:15px;font-weight:700;letter-spacing:.18em;color:${PAPER};">
      <span style="color:${POP};">HERE</span>SAY
    </span>
  </td></tr>

  <tr><td style="padding:34px 30px 30px;">
    <h1 style="margin:0;font-family:${SERIF};font-size:30px;line-height:1.15;font-weight:700;color:${INK};">
      One more tap<br>and you're in.
    </h1>

    <p style="margin:18px 0 0;font-family:${SANS};font-size:15.5px;line-height:1.6;color:${INK_2};">
      Hi ${firstName} — confirm below and your first
      <strong style="color:${INK};">${neighborhood}</strong> issue is on its way.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
      <tr><td style="background:${INK};border-radius:999px;">
        <a href="${confirmUrl}"
           style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:15px;
                  font-weight:600;color:${PAPER};text-decoration:none;">
          Confirm my subscription
        </a>
      </td></tr>
    </table>

    <p style="margin:22px 0 0;font-family:${SANS};font-size:12.5px;line-height:1.6;color:#7A6E64;">
      Button not working? Paste this in:<br>
      <a href="${confirmUrl}" style="color:${POP};word-break:break-all;">${confirmUrl}</a>
    </p>

    <p style="margin:24px 0 0;font-family:${SERIF};font-style:italic;font-size:19px;color:${POP};">
      You didn't hear it from us.
    </p>
  </td></tr>

  <tr><td style="border-top:1px solid ${LINE};padding:18px 30px;">
    <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:#7A6E64;">
      Didn't sign up? Ignore this and nothing happens — you won't hear from us again.
      <br><a href="${unsubscribeUrl}" style="color:#7A6E64;">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return { html, text };
}
