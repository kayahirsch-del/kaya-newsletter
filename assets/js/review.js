/* ==========================================================================
   HERESAY — review queue
   Talks to the `review` edge function. The admin token lives in localStorage
   and never leaves this browser except as a request body field.
   ========================================================================== */

(function () {
  "use strict";

  var CFG = window.HERESAY_CONFIG || {};
  var ENDPOINT = (CFG.supabase.url || "").replace(/\/+$/, "") +
                 "/functions/v1/review";
  var KEY = "heresay:admin-token";
  var BEAT_KEY = "heresay:review-beat";
  var PAGE = 50;

  /* The site's names for the beats, so the back office and the newsletter
     call the same thing the same thing. */
  var BEAT_LABEL = {
    table:  "The Table",
    lineup: "The Lineup",
    haul:   "The Haul",
    other:  "Other"
  };

  var els = {
    gate:     document.querySelector("[data-gate]"),
    gateForm: document.querySelector("[data-gate-form]"),
    gateErr:  document.querySelector("[data-gate-err]"),
    token:    document.querySelector("[data-token]"),
    app:      document.querySelector("[data-app]"),
    tabs:     document.querySelector("[data-tabs]"),
    beats:    document.querySelector("[data-beats]"),
    hood:     document.querySelector("[data-hood]"),
    q:        document.querySelector("[data-q]"),
    count:    document.querySelector("[data-count]"),
    queue:    document.querySelector("[data-queue]"),
    more:     document.querySelector("[data-more]"),
    empty:    document.querySelector("[data-empty]"),
    lock:     document.querySelector("[data-lock]")
  };

  var state = {
    token: localStorage.getItem(KEY) || "",
    status: "new",
    /* Remembered across visits: triage tends to happen one beat at a time,
       and re-picking it on every load gets old fast. */
    category: localStorage.getItem(BEAT_KEY) || "",
    neighborhood: "",
    q: "",
    offset: 0,
    total: 0,
    items: [],
    active: 0
  };

  /* ── api ─────────────────────────────────────────────────────────────── */

  function call(payload) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CFG.supabase.anonKey,
        "Authorization": "Bearer " + CFG.supabase.anonKey
      },
      body: JSON.stringify(Object.assign({ token: state.token }, payload))
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "request failed");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* ── rendering ───────────────────────────────────────────────────────── */

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function card(item, index) {
    var el = document.createElement("article");
    el.className = "card";
    el.dataset.id = item.id;
    el.dataset.index = index;

    var top = document.createElement("div");
    top.className = "card__top";

    var title = document.createElement("h2");
    title.className = "card__title";
    title.textContent = item.title;
    top.appendChild(title);

    var hood = document.createElement("span");
    hood.className = "card__hood" + (item.neighborhood ? "" : " card__hood--none");
    hood.textContent = item.neighborhood || "no neighborhood";
    top.appendChild(hood);

    /* Only worth showing when beats are mixed together. */
    if (!state.category && item.category) {
      var beat = document.createElement("span");
      beat.className = "card__beat";
      beat.textContent = BEAT_LABEL[item.category] || item.category;
      top.appendChild(beat);
    }

    el.appendChild(top);

    var meta = document.createElement("p");
    meta.className = "card__meta";
    meta.textContent = [item.address, fmtDate(item.starts_at), item.source_id]
      .filter(Boolean).join("  ·  ");
    el.appendChild(meta);

    /* A blurb the model couldn't write is the normal case, not an error —
       most of these are genuinely new places nobody has written about. Say
       so where the words would go, so the gap reads as an invitation rather
       than a bug. */
    var needsWords = !item.blurb || /^New licence/.test(item.blurb);

    var blurb = document.createElement("p");
    blurb.className = "card__blurb" + (needsWords ? " card__blurb--empty" : "");
    blurb.textContent = needsWords
      ? (item.blurb || "No description yet") + " — click to write one"
      : item.blurb;
    blurb.addEventListener("click", function () { openEditor(el, item); });
    el.appendChild(blurb);

    var actions = document.createElement("div");
    actions.className = "card__actions";

    var edit = document.createElement("button");
    edit.type = "button";
    edit.className = "act";
    edit.textContent = needsWords ? "Write" : "Edit";
    edit.addEventListener("click", function () { openEditor(el, item); });
    actions.appendChild(edit);

    [["approved", "Approve", "act--yes"],
     ["rejected", "Reject", "act--no"],
     ["new", "Back to new", ""]].forEach(function (spec) {
      if (spec[0] === state.status) return;      // no-op button
      var b = document.createElement("button");
      b.type = "button";
      b.className = "act " + spec[2];
      b.textContent = spec[1];
      b.addEventListener("click", function () { setStatus(item.id, spec[0]); });
      actions.appendChild(b);
    });

    if (item.url) {
      var a = document.createElement("a");
      a.className = "act act--link";
      a.href = item.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Source ↗";
      actions.appendChild(a);
    }

    el.appendChild(actions);
    return el;
  }

  /* ── editing ─────────────────────────────────────────────────────────────
     Replaces the card body in place rather than opening a dialog. Writing
     forty blurbs is the job; a modal that has to be dismissed each time
     turns it into forty-one. */

  function openEditor(cardEl, item) {
    if (cardEl.querySelector(".editor")) return;      // already open
    cardEl.dataset.editing = "true";

    var form = document.createElement("form");
    form.className = "editor";

    var titleLabel = document.createElement("label");
    titleLabel.className = "editor__label";
    titleLabel.textContent = "Name";
    var titleInput = document.createElement("input");
    titleInput.className = "editor__input";
    titleInput.value = item.title;
    /* The licence holder is often an LLC — "Prosciutto, LLC", "Corner Bistro
       East, LLC". The real name is the one worth printing. */
    titleInput.placeholder = "What the place is actually called";
    titleLabel.appendChild(titleInput);

    var blurbLabel = document.createElement("label");
    blurbLabel.className = "editor__label";
    blurbLabel.textContent = "Description";
    var blurbInput = document.createElement("textarea");
    blurbInput.className = "editor__input editor__input--area";
    blurbInput.rows = 3;
    blurbInput.maxLength = 600;
    blurbInput.value = /^New licence/.test(item.blurb || "") ? "" : (item.blurb || "");
    blurbInput.placeholder = "A sentence or two. What it is, what to get.";
    blurbLabel.appendChild(blurbInput);

    var row = document.createElement("div");
    row.className = "editor__row";

    var save = document.createElement("button");
    save.type = "submit";
    save.className = "act act--yes";
    save.textContent = "Save";

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "act";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", function () { closeEditor(cardEl); });

    var hint = document.createElement("span");
    hint.className = "editor__hint";
    hint.textContent = "⌘↵ to save · Esc to cancel";

    row.appendChild(save);
    row.appendChild(cancel);
    row.appendChild(hint);

    form.appendChild(titleLabel);
    form.appendChild(blurbLabel);
    form.appendChild(row);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      saveEdit(cardEl, item, titleInput.value, blurbInput.value, hint);
    });

    form.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeEditor(cardEl); }
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveEdit(cardEl, item, titleInput.value, blurbInput.value, hint);
      }
    });

    cardEl.appendChild(form);
    blurbInput.focus();
  }

  function closeEditor(cardEl) {
    var form = cardEl.querySelector(".editor");
    if (form) form.remove();
    delete cardEl.dataset.editing;
  }

  function saveEdit(cardEl, item, title, blurb, hint) {
    var payload = { action: "update", ids: [item.id] };
    if (title.trim() && title.trim() !== item.title) payload.title = title.trim();
    payload.blurb = blurb;

    hint.textContent = "Saving…";

    call(payload).then(function () {
      /* Update the row in place so the queue doesn't jump — losing your
         position after every save is what makes a long queue unbearable. */
      if (payload.title) item.title = payload.title;
      item.blurb = blurb.trim() || null;
      item.notes = null;

      var idx = state.items.findIndex(function (i) { return i.id === item.id; });
      var wasActive = state.active;
      if (idx >= 0) state.items[idx] = item;
      render();
      state.active = wasActive;
      markActive();
    }).catch(function (err) {
      console.error(err);
      hint.textContent = "Couldn't save — " + err.message;
    });
  }

  function render() {
    els.queue.textContent = "";
    state.items.forEach(function (item, i) {
      els.queue.appendChild(card(item, i));
    });
    markActive();

    els.empty.hidden = state.items.length > 0;
    els.more.hidden = state.items.length >= state.total;
    els.count.textContent = state.total
      ? state.items.length + " of " + state.total
      : "";
  }

  function markActive() {
    var cards = els.queue.querySelectorAll(".card");
    cards.forEach(function (c, i) {
      c.dataset.active = String(i === state.active);
    });
    var el = cards[state.active];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function setTabs(counts) {
    els.tabs.querySelectorAll(".tab").forEach(function (t) {
      var s = t.dataset.status;
      t.setAttribute("aria-selected", String(s === state.status));
      var n = counts && counts[s];
      t.textContent = t.textContent.replace(/\s*\(\d+\)$/, "") +
                      (n ? " (" + n + ")" : "");
    });
  }

  function setBeats(counts) {
    els.beats.querySelectorAll(".beat").forEach(function (b) {
      var c = b.dataset.category || "all";
      b.setAttribute("aria-selected", String(b.dataset.category === state.category));
      var n = counts && counts[c];
      b.textContent = b.textContent.replace(/\s*\(\d+\)$/, "") +
                      (n ? " (" + n + ")" : "");
      /* A beat with nothing in it still gets clicked by accident; dimming it
         says "empty" without removing it and reshuffling the row. */
      b.dataset.empty = String(!n);
    });
  }

  /* The neighborhood list is scoped to the current beat, so it has to be
     rebuilt when the beat changes rather than filled once. */
  function setHoods(list) {
    var current = els.hood.value;
    els.hood.textContent = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = "All neighborhoods";
    els.hood.appendChild(all);

    list.forEach(function (h) {
      var o = document.createElement("option");
      o.value = h;
      o.textContent = h;
      els.hood.appendChild(o);
    });

    /* Keep the filter if this beat still has that neighborhood. */
    if (current && list.indexOf(current) >= 0) els.hood.value = current;
    else if (current) state.neighborhood = "";
  }

  /* ── data ────────────────────────────────────────────────────────────── */

  function load(append) {
    return call({
      action: "list",
      status: state.status,
      category: state.category || undefined,
      neighborhood: state.neighborhood || undefined,
      q: state.q || undefined,
      limit: PAGE,
      offset: append ? state.offset : 0
    }).then(function (data) {
      state.items = append ? state.items.concat(data.items) : data.items;
      state.offset = state.items.length;
      state.total = data.total;
      if (!append) state.active = 0;
      setTabs(data.counts);
      setBeats(data.categoryCounts);
      setHoods(data.neighborhoods || []);
      render();
    }).catch(function (err) {
      if (err.status === 401) return lock("That token didn't work.");
      console.error(err);
      els.count.textContent = "Couldn't load — " + err.message;
    });
  }

  /* Optimistic: the row leaves the current view immediately, and comes back
     if the server refuses. Triage stays fast. */
  function setStatus(id, status) {
    var idx = state.items.findIndex(function (i) { return i.id === id; });
    if (idx < 0) return;
    var removed = state.items[idx];

    state.items.splice(idx, 1);
    state.total = Math.max(state.total - 1, 0);
    if (state.active >= state.items.length) {
      state.active = Math.max(state.items.length - 1, 0);
    }
    render();

    call({ action: "update", ids: [id], status: status }).catch(function (err) {
      console.error(err);
      state.items.splice(idx, 0, removed);
      state.total += 1;
      render();
      els.count.textContent = "Couldn't save — " + err.message;
    });
  }

  /* ── gate ────────────────────────────────────────────────────────────── */

  function unlock() {
    els.gate.hidden = true;
    els.app.hidden = false;
    load(false);
  }

  function lock(message) {
    localStorage.removeItem(KEY);
    state.token = "";
    els.app.hidden = true;
    els.gate.hidden = false;
    if (message) {
      els.gateErr.textContent = message;
      els.gateErr.hidden = false;
    }
  }

  els.gateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    els.gateErr.hidden = true;
    state.token = els.token.value.trim();
    if (!state.token) return;
    localStorage.setItem(KEY, state.token);
    unlock();
  });

  els.lock.addEventListener("click", function () { lock(""); });

  /* ── controls ────────────────────────────────────────────────────────── */

  els.tabs.addEventListener("click", function (e) {
    var tab = e.target.closest(".tab");
    if (!tab) return;
    state.status = tab.dataset.status;
    load(false);
  });

  els.beats.addEventListener("click", function (e) {
    var beat = e.target.closest(".beat");
    if (!beat) return;
    state.category = beat.dataset.category;
    localStorage.setItem(BEAT_KEY, state.category);
    load(false);
  });

  els.hood.addEventListener("change", function () {
    state.neighborhood = els.hood.value;
    load(false);
  });

  var qTimer;
  els.q.addEventListener("input", function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () {
      state.q = els.q.value.trim();
      load(false);
    }, 300);
  });

  els.more.addEventListener("click", function () { load(true); });

  /* Keyboard triage. A queue you have to mouse through is a queue you stop
     using, so j/k move and a/r/u act on the highlighted row. */
  document.addEventListener("keydown", function (e) {
    if (els.app.hidden) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var k = e.key.toLowerCase();
    var current = state.items[state.active];
    var activeCard = els.queue.querySelectorAll(".card")[state.active];

    /* An open editor owns the keyboard. Without this, tabbing out of the
       textarea and hitting R to type a word would reject the row you were
       halfway through writing. */
    if (activeCard && activeCard.dataset.editing) return;

    if (k === "j") { state.active = Math.min(state.active + 1, state.items.length - 1); markActive(); e.preventDefault(); }
    else if (k === "k") { state.active = Math.max(state.active - 1, 0); markActive(); e.preventDefault(); }
    else if (k === "a" && current) { setStatus(current.id, "approved"); e.preventDefault(); }
    else if (k === "r" && current) { setStatus(current.id, "rejected"); e.preventDefault(); }
    else if (k === "u" && current) { setStatus(current.id, "new"); e.preventDefault(); }
    else if (k === "e" && current && activeCard) {
      openEditor(activeCard, current);
      e.preventDefault();
    }
  });

  /* ── boot ────────────────────────────────────────────────────────────── */
  if (state.token) unlock();
})();
