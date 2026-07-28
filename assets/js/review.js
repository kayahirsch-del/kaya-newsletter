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
  var PAGE = 50;

  var els = {
    gate:     document.querySelector("[data-gate]"),
    gateForm: document.querySelector("[data-gate-form]"),
    gateErr:  document.querySelector("[data-gate-err]"),
    token:    document.querySelector("[data-token]"),
    app:      document.querySelector("[data-app]"),
    tabs:     document.querySelector("[data-tabs]"),
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
    neighborhood: "",
    q: "",
    offset: 0,
    total: 0,
    items: [],
    active: 0,
    hoodsLoaded: false
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

    el.appendChild(top);

    var meta = document.createElement("p");
    meta.className = "card__meta";
    meta.textContent = [item.address, fmtDate(item.starts_at), item.source_id]
      .filter(Boolean).join("  ·  ");
    el.appendChild(meta);

    if (item.blurb) {
      var blurb = document.createElement("p");
      blurb.className = "card__blurb";
      blurb.textContent = item.blurb;
      el.appendChild(blurb);
    }

    var actions = document.createElement("div");
    actions.className = "card__actions";

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

  function setHoods(list) {
    if (state.hoodsLoaded) return;
    list.forEach(function (h) {
      var o = document.createElement("option");
      o.value = h;
      o.textContent = h;
      els.hood.appendChild(o);
    });
    state.hoodsLoaded = true;
  }

  /* ── data ────────────────────────────────────────────────────────────── */

  function load(append) {
    return call({
      action: "list",
      status: state.status,
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

    if (k === "j") { state.active = Math.min(state.active + 1, state.items.length - 1); markActive(); e.preventDefault(); }
    else if (k === "k") { state.active = Math.max(state.active - 1, 0); markActive(); e.preventDefault(); }
    else if (k === "a" && current) { setStatus(current.id, "approved"); e.preventDefault(); }
    else if (k === "r" && current) { setStatus(current.id, "rejected"); e.preventDefault(); }
    else if (k === "u" && current) { setStatus(current.id, "new"); e.preventDefault(); }
  });

  /* ── boot ────────────────────────────────────────────────────────────── */
  if (state.token) unlock();
})();
