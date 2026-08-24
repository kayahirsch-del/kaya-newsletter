/* ===========================================================================
   POST /functions/v1/describe-items
     { token, city_id?, status?, limit?, dry_run?, redescribe? }

   Replaces the placeholder blurb on licence-derived items with something a
   person would actually read, and flags the ones that shouldn't be in the
   queue at all.

   The problem
   -----------
   `ingest-nysla` writes "Restaurant issued 2026-07-27 — 185 AVENUE C",
   because that is genuinely everything the dataset contains: name, address,
   licence class, date. There is no description to extract. It reads like a
   database row because it is one.

   Why a model, and where the danger is
   ------------------------------------
   The obvious move — ask an LLM to write a description — is also how you
   mail somebody a confident, fluent account of a restaurant that does not
   exist. A new venue is new: nobody has written about it, the model has
   never seen it, and asked to describe it anyway it will produce something
   plausible. That is worse than the placeholder, because the placeholder is
   obviously a placeholder.

   So the tool is built to make "I don't know this place" a first-class
   answer, and the prompt spends most of its words on that. No knowledge, no
   blurb — the item keeps a plain factual line and waits for a human.

   The same call earns its keep twice
   ----------------------------------
   Recognising a place is exactly what tells us a licence is a renewal. The
   dataset is *current active licences*, so Rubirosa (Mulberry St since 2010)
   and Pastis turn up with fresh issue dates looking like openings. If the
   model knows a venue as long-established, this is a renewal and doesn't
   belong in a newsletter about what's new.

   Those are set to `rejected` with the reason recorded, and only when the
   model is confident. It's reversible — U in the review queue puts anything
   back — and the alternative is an editor eyeballing 369 rows.
   =========================================================================== */

import Anthropic from "npm:@anthropic-ai/sdk@0.115.0";
import { CORS, json } from "../_shared/brand.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN");
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const REST = `${SUPABASE_URL}/rest/v1`;

const restHeaders = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

/* Small enough that one bad batch costs little, large enough that the fixed
   cost of the system prompt is amortised. */
const BATCH = 20;

/* Batches run concurrently. One batch of 20 takes about a minute, and 366
   items sequentially is nineteen minutes — well past the wall clock an edge
   function gets. Three at a time keeps a call to roughly a minute, which is
   also what fits comfortably under the invocation limit. */
const CONCURRENCY = 3;

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

const TOOL = {
  name: "record_venue",
  description:
    "Record what you know about one venue from a New York liquor licence " +
    "filing. Call once per venue, for every venue in the batch, including " +
    "the ones you don't recognise.",
  input_schema: {
    type: "object" as const,
    properties: {
      ref: {
        type: "string",
        description: "The ref given with the venue. Copy it exactly.",
      },
      recognised: {
        type: "boolean",
        description:
          "True only if you actually know this specific venue at this " +
          "address from your training data. A guess based on the name " +
          "sounding Italian is not knowing it. When in doubt, false.",
      },
      standing: {
        type: "string",
        enum: ["long_established", "recent", "unknown"],
        description:
          "'long_established' if this venue has been operating at this " +
          "address for years — which means the licence is a renewal, not " +
          "an opening. 'recent' if you know it and it opened in roughly " +
          "the last year. 'unknown' if you don't know it.",
      },
      blurb: {
        type: "string",
        description:
          "One or two sentences on what the place actually is: the kind of " +
          "food, the room, what people go for. Concrete and plain, the way " +
          "you'd describe it to a friend. Omit entirely unless recognised " +
          "is true. Never describe a place you don't know.",
      },
      kind: {
        type: "string",
        description:
          "Short category if known, e.g. 'Italian', 'natural wine bar', " +
          "'coffee shop'. Omit if not known.",
      },
    },
    required: ["ref", "recognised", "standing"],
  },
};

type Verdict = {
  ref: string;
  recognised: boolean;
  standing: "long_established" | "recent" | "unknown";
  blurb?: string;
  kind?: string;
};

type Row = {
  id: string;
  title: string;
  address: string | null;
  neighborhood: string | null;
  postal_code: string | null;
  blurb: string | null;
  starts_at: string | null;
};

async function describeBatch(rows: Row[]): Promise<Verdict[]> {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const listing = rows.map((r, n) =>
    `<venue ref="${n}">\n` +
    `  <name>${r.title}</name>\n` +
    `  <address>${r.address ?? ""}</address>\n` +
    `  <neighborhood>${r.neighborhood ?? ""}</neighborhood>\n` +
    `  <zip>${r.postal_code ?? ""}</zip>\n` +
    `</venue>`
  ).join("\n");

  const msg = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    tools: [TOOL],
    system:
      "You are helping a New York City newsletter tell new restaurant and " +
      "bar openings apart from licence renewals at places that have been " +
      "around for years, and write a short description of the ones you " +
      "actually know.\n\n" +

      "These come from the State Liquor Authority's list of currently " +
      "active licences. That list contains both, and the issue date looks " +
      "the same either way, so the only thing that separates them is " +
      "whether the venue is already known.\n\n" +

      "THE RULE THAT MATTERS MOST: never describe a venue you do not know. " +
      "Most of these are genuinely new — no one has written about them, and " +
      "you have never seen them. For those, set recognised false, standing " +
      "'unknown', and write no blurb. An honest blank is correct and useful. " +
      "A fluent invented description is the worst possible output here, " +
      "because it will be printed and sent to real readers as fact.\n\n" +

      "Recognising a name is not knowing a venue. There are many " +
      "restaurants called Ivy, Sage, Lucia. Only set recognised true if you " +
      "know this specific place at roughly this address. A licence holder " +
      "is often an LLC ('Corner Bistro East, LLC', 'Crosby Street Hotel " +
      "LLC') — you may know the venue behind the entity, but do not invent " +
      "one to fit the name.\n\n" +

      "Call record_venue exactly once for every venue in the batch, in " +
      "order, copying each ref verbatim.",
    messages: [{
      role: "user",
      content: `<venues>\n${listing}\n</venues>`,
    }],
  });

  return msg.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => b.input as Verdict)
    .filter((v) => v && typeof v.ref === "string");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!ADMIN_TOKEN) return json({ error: "not configured" }, 503);
  if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY unset" }, 503);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "invalid JSON" }, 400);
  if (!tokenOk(body.token)) return json({ error: "unauthorized" }, 401);

  const cityId = String(body.city_id ?? "nyc");
  const status = String(body.status ?? "new");
  const limit = Math.min(Number(body.limit ?? 60), 400);
  const dryRun = body.dry_run === true;

  const params: Record<string, string> = {
    city_id: `eq.${cityId}`,
    status: `eq.${status}`,
    source_id: "eq.nysla",
    select: "id,title,address,neighborhood,postal_code,blurb,starts_at",
    order: "starts_at.desc.nullslast",
    limit: String(limit),
  };
  /* Only the untouched placeholder blurbs, unless asked to redo everything.
     `issued` is the giveaway — nothing a human or the model writes says it. */
  if (!body.redescribe) params.blurb = "like.*issued*";

  const res = await fetch(`${REST}/items?${q(params)}`, { headers: restHeaders });
  const rows: Row[] = await res.json().catch(() => []);
  if (!rows.length) return json({ ok: true, examined: 0, note: "nothing to describe" });

  let described = 0;
  let renewals = 0;
  let unknown = 0;
  const samples: Record<string, unknown>[] = [];
  const failures: string[] = [];

  /* Split into batches up front, then run them CONCURRENCY at a time. */
  const batches: Row[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));

  const results: { batch: Row[]; verdicts: Verdict[] }[] = [];
  for (let w = 0; w < batches.length; w += CONCURRENCY) {
    const wave = batches.slice(w, w + CONCURRENCY);
    const settled = await Promise.allSettled(wave.map((b) => describeBatch(b)));

    settled.forEach((s, n) => {
      if (s.status === "fulfilled") {
        results.push({ batch: wave[n], verdicts: s.value });
      } else {
        /* One bad batch shouldn't lose the wave — the rows it covered simply
           keep their placeholder and get picked up on the next run, since the
           query selects on the placeholder text. */
        failures.push(`batch ${w + n}: ${String(s.reason).slice(0, 120)}`);
      }
    });
  }

  for (const { batch, verdicts } of results) {
    const patches: { id: string; patch: Record<string, unknown> }[] = [];

    for (const v of verdicts) {
      const row = batch[Number(v.ref)];
      if (!row) continue;

      /* A renewal at a place that's been there for years isn't news. Only
         acted on when the model says it knows the venue — "unknown" never
         rejects anything. */
      if (v.recognised && v.standing === "long_established") {
        renewals++;
        patches.push({
          id: row.id,
          patch: {
            status: "rejected",
            notes: "Licence renewal — established venue, not a new opening",
            ...(v.blurb ? { blurb: v.blurb.slice(0, 600) } : {}),
          },
        });
        samples.push({ title: row.title, verdict: "renewal", kind: v.kind });
        continue;
      }

      if (v.recognised && v.blurb) {
        described++;
        patches.push({
          id: row.id,
          patch: { blurb: v.blurb.slice(0, 600), notes: null },
        });
        samples.push({ title: row.title, blurb: v.blurb, kind: v.kind });
        continue;
      }

      /* Not known. Keep a plain factual line rather than a fabricated one,
         and say so on the card so an editor knows there's nothing to add
         without going and looking. */
      unknown++;
      const where = row.address ?? row.neighborhood ?? "";
      patches.push({
        id: row.id,
        patch: {
          blurb: where ? `New licence at ${where}` : "New licence",
          notes: "No description — model doesn't know this venue. Needs a human.",
        },
      });
    }

    /* Each row gets a different patch, so this is one request per row rather
       than a bulk upsert. Issued together — twenty sequential round trips to
       PostgREST is most of a batch's wall clock for no reason. */
    if (!dryRun) {
      await Promise.all(patches.map((p) =>
        fetch(`${REST}/items?id=eq.${p.id}`, {
          method: "PATCH",
          headers: { ...restHeaders, Prefer: "return=minimal" },
          body: JSON.stringify(p.patch),
        })
      ));
    }
  }

  console.log(
    `described ${described}, renewals ${renewals}, unknown ${unknown} of ${rows.length}`,
  );

  return json({
    ok: true,
    dry_run: dryRun,
    examined: rows.length,
    described,
    renewals_rejected: renewals,
    unknown,
    failures,
    samples: samples.slice(0, 12),
  });
});
