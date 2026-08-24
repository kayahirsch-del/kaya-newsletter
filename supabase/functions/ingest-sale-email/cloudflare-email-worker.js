/* ===========================================================================
   Cloudflare Email Worker — sales@itsallheresay.com → ingest-sale-email

   Not deployed by Supabase. This runs on Cloudflare, which is already where
   the domain's DNS lives, so catching mail there costs nothing and needs no
   new vendor. Paste it into a Worker and bind it under
   Email → Email Routing → Routing rules.

   Why there's no parsing here any more
   ------------------------------------
   The first version pulled the text and HTML parts out of the raw message
   before posting them. It worked on Gmail and returned both parts empty on
   the first message from a different client — and because Workers Logs were
   off, there was nothing to look at. The lesson wasn't "write a better
   boundary split", it was that fragile code belongs where its logs are
   readable. So this now forwards the message and posts the raw RFC 822
   stream; the edge function does the parsing, and a bad decode shows up in
   the Supabase function logs.

   What's left here is hard to get wrong: forward, POST, don't bounce.

   Setup, in order:
     1. Cloudflare → itsallheresay.com → Email → Email Routing → enable
     2. Add and verify the destination address that gets a human copy
     3. Workers & Pages → Create → Worker → paste this
     4. Settings → Variables → add INBOUND_SECRET (same value as the Supabase
        secret), FUNCTION_URL, and ARCHIVE_TO
     5. Deploy again — variables don't reach a running Worker until you do
     6. Email Routing → Routing rules → custom address `sales@` → send to this
        Worker
     7. Turn on Observability → Workers Logs. Without it the console lines
        below go nowhere, which is the hole that hid the bug above.
     8. Subscribe sales@itsallheresay.com to the vendor mailing lists

   Why it forwards as well as posts
   --------------------------------
   A routing rule sends mail to exactly one place, so pointing `sales@` at
   this Worker means nothing else receives it. That breaks two things at once:

     - Any confirmation email — a list's double opt-in, or Gmail's code when
       you add this as a forwarding address — arrives here, gets parsed as a
       sale, found not to be one, and discarded. You can never click the link
       because you never see it.
     - When the Worker throws, the message is gone with it.

   So every message is also forwarded to ARCHIVE_TO, a verified destination.
   The forward is what a human reads; the POST is what fills the queue.
   =========================================================================== */

export default {
  async email(message, env, ctx) {
    /* Awaited and first: a confirmation link that never arrives is worse than
       a sale that never gets filed. Failures are logged, never thrown —
       throwing bounces the message back to the sender, and a vendor whose
       mail bounces will eventually drop us from the list. */
    if (env.ARCHIVE_TO) {
      try {
        await message.forward(env.ARCHIVE_TO);
        console.log("forwarded to", env.ARCHIVE_TO);
      } catch (err) {
        console.error("forward failed", String(err));
      }
    } else {
      console.warn("ARCHIVE_TO unset — no human copy of this message");
    }

    const raw = await new Response(message.raw).text();
    console.log("raw bytes", raw.length, "from", message.from);

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
        raw,
      }),
    })
      .then(async (res) => {
        const detail = await res.text().catch(() => "");
        if (res.ok) console.log("ingest ok", detail.slice(0, 200));
        else console.error("ingest failed", res.status, detail.slice(0, 200));
      })
      .catch((err) => console.error("ingest error", String(err)));

    /* Don't make the sending server wait on our pipeline. */
    ctx.waitUntil(post);
  },
};
