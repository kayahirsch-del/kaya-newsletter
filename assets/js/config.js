/* ==========================================================================
   HERESAY — configuration
   Everything you'd want to rename or re-tune lives in this one file.
   ========================================================================== */

window.HERESAY_CONFIG = {

  /* The name is not configurable from here. The wordmark splits HERE from SAY
     so the pun reads visually, which needs markup rather than a string — see
     `.brand-lead` in the HTML and stylesheet. For email it lives in
     `BRAND` in supabase/functions/_shared/brand.ts. */

  /* Day the issue goes out — used in the preview and the success message. */
  sendDay: "Thursday",

  /* ── Interests ─────────────────────────────────────────────────────────
     `id` is what gets stored in the database — don't change ids after
     you have real subscribers. `label` is what people see.            */
  interests: [
    { id: "restaurants", label: "New restaurants",     default: true  },
    { id: "sample_sales", label: "Sample sales",       default: true  },
    { id: "concerts",    label: "Concerts",            default: true  },
    { id: "events",      label: "Events & pop-ups",    default: true  },
    { id: "nightlife",   label: "Bars & nightlife",    default: false },
    { id: "shopping",    label: "Shopping & markdowns", default: false },
    { id: "vintage",     label: "Thrift & vintage",    default: false },
    { id: "beauty",      label: "Beauty & salons",     default: false },
    { id: "fitness",     label: "Classes & fitness",   default: false },
    { id: "art",         label: "Art & galleries",     default: false }
  ],

  /* ── Cadence options ─────────────────────────────────────────────────── */
  cadences: [
    { id: "weekly",       label: "Once a week",   default: true  },
    { id: "twice_weekly", label: "Twice a week",  default: false },
    { id: "monthly",      label: "Just the big stuff", default: false }
  ],

  /* ── Storage ───────────────────────────────────────────────────────────
     Leave `url` empty and signups are kept in the browser only (great for
     demoing). Fill both in and the form posts to your Supabase table.

     The publishable/anon key is safe to ship in client code — row-level
     security on the table is what actually protects the data. See
     supabase/migrations/ for the schema and policies.                   */
  supabase: {
    url: "https://bmtcbhgzmuktibtqjqco.supabase.co",
    anonKey: "sb_publishable_3p94FolkVEhAt8KHl3dQ7g_6WiaMXmg",
    table: "subscribers"
  }
};
