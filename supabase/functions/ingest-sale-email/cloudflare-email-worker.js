/* ===========================================================================
   Cloudflare Email Worker — sales@itsallheresay.com → ingest-sale-email

   Not deployed by Supabase. This runs on Cloudflare, which is already where
   the domain's DNS lives, so catching mail there costs nothing and needs no
   new vendor. Paste it into a Worker and bind it under
   Email → Email Routing → Routing rules.

   Cloudflare hands the Worker a raw RFC 822 stream. We pull the plain-text
   part if there is one, fall back to the HTML part, and POST it on. All the
   real parsing happens downstream — this is a pipe with a secret on it.

   Setup, in order:
     1. Cloudflare → itsallheresay.com → Email → Email Routing → enable
     2. Add the destination address you want the raw mail archived at
     3. Workers & Pages → Create → Worker → paste this
     4. Settings → Variables → add INBOUND_SECRET (same value as the Supabase
        secret) and FUNCTION_URL
     5. Email Routing → Routing rules → custom address `sales@` → send to this
        Worker
     6. Subscribe sales@itsallheresay.com to the vendor mailing lists

   Keep the plain forward in step 2. If the Worker throws, mail still lands
   somewhere a human can read it, and a missed sale beats a silent drop.
   =========================================================================== */

export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).text();

    const post = fetch(env.FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-heresay-secret": env.INBOUND_SECRET,
      },
      body: JSON.stringify({
        from: message.from,
        subject: message.headers.get("subject") ?? "",
        message_id: message.headers.get("message-id") ?? "",
        text: part(raw, "text/plain"),
        html: part(raw, "text/html"),
      }),
    }).then((res) => {
      /* Logged, not thrown. Rejecting the message would bounce it back to the
         sender, which over time gets us dropped from the mailing lists we
         went to the trouble of joining. */
      if (!res.ok) console.error("ingest failed", res.status);
    }).catch((err) => console.error("ingest error", err));

    /* Don't make the sender wait on our pipeline. */
    ctx.waitUntil(post);
  },
};

/* Minimal MIME slice: find the boundary, return the first part with the
   content type we asked for, undo quoted-printable if it's used. Marketing
   mail is overwhelmingly multipart/alternative with exactly these two parts,
   and anything this misses still reaches the model as the other part. */
function part(raw, type) {
  const boundary = raw.match(/boundary="?([^"\s;]+)"?/i)?.[1];
  const chunks = boundary ? raw.split(`--${boundary}`) : [raw];

  for (const chunk of chunks) {
    if (!chunk.toLowerCase().includes(`content-type: ${type}`)) continue;

    const split = chunk.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
    const body = chunk.slice(chunk.indexOf(split) + split.length).trim();

    return /quoted-printable/i.test(chunk) ? unQP(body) : body;
  }
  return undefined;
}

function unQP(s) {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
