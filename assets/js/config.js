/* ==========================================================================
   SPOTTED — configuration
   Everything you'd want to rename or re-tune lives in this one file.
   ========================================================================== */

window.SPOTTED_CONFIG = {

  /* Brand name. Change it here and it updates everywhere on the page. */
  brand: "SPOTTED",

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
    url: "",           // e.g. "https://xxxxxxxx.supabase.co"
    anonKey: "",       // publishable "anon" key
    table: "subscribers"
  }
};
