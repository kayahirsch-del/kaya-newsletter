/* ===========================================================================
   The issue itself — subject line and email body.

   Table-based layout with inline styles, because that is still what Gmail,
   Outlook and Apple Mail agree on. No flexbox, no grid, no <style> block:
   Gmail strips head styles and Outlook renders through Word.

   The voice matters more than the markup here. Every item is a place to go,
   written as if someone told you about it — not a listing. The neighborhood
   is the headline, because that's the whole promise.
   =========================================================================== */

import { BRAND } from "./brand.ts";

const PAPER = "#FAF3EA";
const INK = "#14100E";
const INK_2 = "#453B34";
const INK_3 = "#7A6E64";
const POP = "#E11D5C";
const LINE = "#DFCDB8";

const SERIF = `"Bodoni Moda", Didot, "Didot LT STD", "Hoefler Text", Georgia, serif`;
const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;

export type IssueItem = {
  id: string;
  title: string;
  blurb: string | null;
  url: string | null;
  address: string | null;
  venue_name: string | null;
  neighborhood: string | null;
  category: string;
  starts_at: string | null;
  ends_at: string | null;
  /* Set by the builder when an item came from the city-wide top-up rather
     than the subscriber's own neighborhood. It changes the heading it sits
     under, so we never imply something is local when it isn't. */
  citywide?: boolean;
};

/* The beats, in the order they run in the issue. Eat first — it's the one
   people act on same-day. */
const BEATS: { key: string; label: string; blurb: string }[] = [
  { key: "table",  label: "The Table",  blurb: "Where to eat" },
  { key: "lineup", label: "The Lineup", blurb: "What's on" },
  { key: "haul",   label: "The Haul",   blurb: "What's on sale" },
  { key: "other",  label: "Also",       blurb: "" },
];

/* Escape anything that reaches markup. Item text comes from feeds, licence
   filings and marketing email — none of it ours, all of it untrusted. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* "Sep 12", or "Sep 12–14" when it runs. Sample sales are the reason this
   exists: a date range is the difference between going and missing it. */
function dateLine(item: IssueItem, tz: string): string {
  if (!item.starts_at) return "";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: tz,
    });

  const start = fmt(item.starts_at);
  if (!item.ends_at) return start;

  const end = fmt(item.ends_at);
  return start === end ? start : `${start}–${end}`;
}

/* Street, or venue and street. Skips the ALL-CAPS shouting that comes out of
   the licence data — a headline in caps reads as an error, not emphasis. */
function whereLine(item: IssueItem): string {
  const parts = [item.venue_name, item.address].filter(Boolean) as string[];
  return parts
    .map((p) => (p === p.toUpperCase() ? titleCase(p) : p))
    .join(", ");
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/* ── one item ─────────────────────────────────────────────────────────────── */

function itemBlock(item: IssueItem, tz: string): string {
  const when = dateLine(item, tz);
  const where = whereLine(item);
  const meta = [when, where].filter(Boolean).join("&nbsp;&nbsp;·&nbsp;&nbsp;");

  const title = item.url
    ? `<a href="${esc(item.url)}" style="color:${INK};text-decoration:none;">${esc(item.title)}</a>`
    : esc(item.title);

  return `
  <tr><td style="padding:0 0 26px;">
    <p style="margin:0 0 3px;font-family:${SANS};font-size:11px;font-weight:700;
              letter-spacing:.14em;text-transform:uppercase;color:${POP};">
      ${esc(item.neighborhood ?? "")}
    </p>
    <h3 style="margin:0;font-family:${SERIF};font-size:21px;line-height:1.25;
               font-weight:700;color:${INK};">${title}</h3>
    ${
    meta
      ? `<p style="margin:5px 0 0;font-family:${SANS};font-size:12.5px;color:${INK_3};">${meta}</p>`
      : ""
  }
    ${
    item.blurb
      ? `<p style="margin:8px 0 0;font-family:${SANS};font-size:14.5px;
                   line-height:1.55;color:${INK_2};">${esc(item.blurb)}</p>`
      : ""
  }
  </td></tr>`;
}

/* ── one beat ─────────────────────────────────────────────────────────────── */

function beatBlock(
  label: string,
  kicker: string,
  items: IssueItem[],
  tz: string,
): string {
  if (!items.length) return "";

  return `
  <tr><td style="padding:6px 0 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid ${LINE};padding-top:14px;">
        <p style="margin:0;font-family:${SERIF};font-size:13px;font-weight:700;
                  letter-spacing:.2em;text-transform:uppercase;color:${INK};">
          ${esc(label)}
        </p>
        ${
    kicker
      ? `<p style="margin:2px 0 0;font-family:${SANS};font-style:italic;
                   font-size:13px;color:${INK_3};">${esc(kicker)}</p>`
      : ""
  }
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding-top:18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${items.map((i) => itemBlock(i, tz)).join("")}
    </table>
  </td></tr>`;
}

/* ── the issue ────────────────────────────────────────────────────────────── */

export function issueEmail(opts: {
  firstName: string;
  neighborhood: string;
  items: IssueItem[];
  intro?: string | null;
  unsubscribeUrl: string;
  timezone?: string;
}): { subject: string; html: string; text: string } {
  const {
    firstName,
    neighborhood,
    items,
    intro,
    unsubscribeUrl,
    timezone = "America/New_York",
  } = opts;

  const local = items.filter((i) => !i.citywide);
  const citywide = items.filter((i) => i.citywide);

  /* Lead with the best local item — a subject line naming a real place beats
     "Your Chelsea issue" every time. Falls back to the neighborhood when the
     whole issue is city-wide. */
  const lead = local[0] ?? citywide[0];
  const subject = lead
    ? `${lead.title} — and ${items.length - 1} more near ${neighborhood}`
    : `Your ${neighborhood} issue`;

  const byBeat = (list: IssueItem[]) =>
    BEATS.map((b) =>
      beatBlock(b.label, b.blurb, list.filter((i) => i.category === b.key), timezone)
    ).join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td align="center" style="padding:30px 16px 50px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">

  <tr><td style="background:${INK};padding:15px 26px;">
    <span style="font-family:${SERIF};font-size:16px;font-weight:700;letter-spacing:.2em;color:${PAPER};">
      <span style="color:${POP};">HERE</span>SAY
    </span>
    <span style="float:right;font-family:${SANS};font-size:11px;letter-spacing:.1em;
                 text-transform:uppercase;color:#9C9089;">${esc(neighborhood)}</span>
  </td></tr>

  <tr><td style="padding:30px 30px 6px;">
    <h1 style="margin:0;font-family:${SERIF};font-size:27px;line-height:1.2;font-weight:700;color:${INK};">
      ${esc(firstName)}, here's what's going around.
    </h1>
    ${
    intro
      ? `<p style="margin:12px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK_2};">${esc(intro)}</p>`
      : ""
  }
  </td></tr>

  <tr><td style="padding:16px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${byBeat(local)}
      ${
    citywide.length
      ? `<tr><td style="padding:10px 0 16px;">
             <p style="margin:0;font-family:${SERIF};font-size:13px;font-weight:700;
                       letter-spacing:.2em;text-transform:uppercase;color:${INK};
                       border-top:1px solid ${LINE};padding-top:14px;">Worth the trip</p>
             <p style="margin:2px 0 0;font-family:${SANS};font-style:italic;font-size:13px;color:${INK_3};">
               Not your blocks, but we'd go
             </p>
           </td></tr>
           <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
             ${citywide.map((i) => itemBlock(i, timezone)).join("")}
           </table></td></tr>`
      : ""
  }
    </table>
  </td></tr>

  <tr><td style="padding:4px 30px 26px;">
    <p style="margin:0;font-family:${SERIF};font-style:italic;font-size:19px;color:${POP};">
      You didn't hear it from us.
    </p>
  </td></tr>

  <tr><td style="border-top:1px solid ${LINE};padding:18px 30px;">
    <p style="margin:0;font-family:${SANS};font-size:11.5px;line-height:1.6;color:${INK_3};">
      You're getting this because you signed up for ${BRAND} in ${esc(neighborhood)}.
      <br><a href="${esc(unsubscribeUrl)}" style="color:${INK_3};">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  /* Plain-text alternative. Not decoration — a message with no text part
     scores worse with spam filters, and some clients still prefer it. */
  const line = (i: IssueItem) => {
    const bits = [dateLine(i, timezone), whereLine(i)].filter(Boolean).join(" · ");
    return [
      `${i.neighborhood ?? ""} — ${i.title}`,
      bits && `  ${bits}`,
      i.blurb && `  ${i.blurb}`,
      i.url && `  ${i.url}`,
    ].filter(Boolean).join("\n");
  };

  const section = (label: string, list: IssueItem[]) =>
    list.length ? [``, label.toUpperCase(), ``, ...list.map(line)].join("\n") : "";

  const text = [
    `${firstName}, here's what's going around.`,
    intro ? `\n${intro}` : "",
    ...BEATS.map((b) =>
      section(b.label, local.filter((i) => i.category === b.key))
    ),
    citywide.length ? section("Worth the trip", citywide) : "",
    ``,
    `You didn't hear it from us.`,
    ``,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}
