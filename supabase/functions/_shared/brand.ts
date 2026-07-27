/* Shared brand chrome for SPOTTED's transactional email and landing pages.
   Email clients don't load webfonts reliably, so the display face falls back
   through Didot to Georgia rather than depending on Bodoni Moda. */

export const BRAND = "SPOTTED";

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
      ${BRAND}
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
      xoxo
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

/* ── landing pages for the emailed links ────────────────────────────────── */

export function page(opts: {
  kicker: string;
  title: string;
  body: string;
  action?: { url: string; label: string };
  status?: number;
}) {
  const { kicker, title, body, action, status = 200 } = opts;

  const button = action
    ? `<form method="POST" action="${action.url}" style="margin-top:28px;">
         <button type="submit"
           style="font-family:${SANS};font-size:15px;font-weight:600;color:${PAPER};
                  background:${INK};border:none;border-radius:999px;
                  padding:14px 32px;cursor:pointer;">${action.label}</button>
       </form>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — ${BRAND}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:${PAPER};color:${INK};font-family:${SANS};padding:24px;}
  .card{max-width:460px;text-align:center;}
  .kicker{font-size:12px;letter-spacing:.24em;text-transform:uppercase;
          color:${POP};font-weight:700;margin:0 0 16px;}
  h1{margin:0;font-family:${SERIF};font-weight:700;font-size:clamp(2rem,6vw,2.8rem);
     line-height:1.1;}
  p{margin:18px 0 0;font-size:16px;line-height:1.6;color:${INK_2};}
  .mark{margin-top:40px;font-family:${SERIF};font-weight:800;font-size:15px;
        letter-spacing:.18em;color:${INK};}
  button:hover{background:${POP};}
</style></head>
<body><div class="card">
  <p class="kicker">${kicker}</p>
  <h1>${title}</h1>
  <p>${body}</p>
  ${button}
  <p class="mark">${BRAND}</p>
</div></body></html>`;

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...CORS },
  });
}
