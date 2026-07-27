/* ==========================================================================
   SPOTTED — signup page behaviour
   No framework, no build step. Load order: config.js, neighborhoods.js, app.js
   ========================================================================== */

(function () {
  "use strict";

  var CFG    = window.SPOTTED_CONFIG || {};
  var CITIES = window.SPOTTED_CITIES || [];

  var form   = document.getElementById("signup-form");
  var doneEl = document.querySelector("[data-done]");
  var status = document.querySelector("[data-form-status]");
  var submit = document.querySelector("[data-submit]");

  var els = {
    firstName: document.getElementById("first_name"),
    email:     document.getElementById("email"),
    city:      document.getElementById("city"),
    hood:      document.getElementById("neighborhood"),
    hoodList:  document.getElementById("hood-list"),
    street:    document.getElementById("street_address"),
    interests: document.getElementById("interests"),
    cadence:   document.getElementById("cadence")
  };

  /* ── helpers ─────────────────────────────────────────────────────────── */

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach(function (n) {
      n.textContent = value;
    });
  }

  function cityById(id) {
    return CITIES.filter(function (c) { return c.id === id; })[0] || null;
  }

  /* Collapse whitespace and, when the typed value matches a known
     neighborhood, snap to that entry's canonical casing. Keeps "west village",
     "WEST VILLAGE" and "West  Village" from becoming three different
     neighborhoods in the database. */
  function normalizeHood(raw, cityId) {
    var value = String(raw || "").replace(/\s+/g, " ").trim();
    if (!value) return "";
    var city = cityById(cityId);
    if (city) {
      var match = city.neighborhoods.filter(function (n) {
        return n.toLowerCase() === value.toLowerCase();
      })[0];
      if (match) return match;
    }
    return value;
  }

  /* Next occurrence of the configured send day, e.g. "Thursday". */
  function nextSendDate() {
    var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday",
                "Friday", "Saturday"];
    var target = days.indexOf(CFG.sendDay || "Thursday");
    if (target < 0) target = 4;

    var d = new Date();
    var delta = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  }

  /* ── build the form from config ──────────────────────────────────────── */

  function buildCities() {
    CITIES.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label;
      els.city.appendChild(opt);
    });
  }

  function buildHoodList(cityId) {
    els.hoodList.textContent = "";
    var city = cityById(cityId);
    if (!city) return;
    city.neighborhoods.forEach(function (n) {
      var opt = document.createElement("option");
      opt.value = n;
      els.hoodList.appendChild(opt);
    });
  }

  function buildInterests() {
    (CFG.interests || []).forEach(function (item) {
      var label = document.createElement("label");
      label.className = "chip";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.name = "interests";
      input.value = item.id;
      input.checked = !!item.default;

      var span = document.createElement("span");
      span.textContent = item.label;

      label.appendChild(input);
      label.appendChild(span);
      els.interests.appendChild(label);

      input.addEventListener("change", function () { clearError("interests"); });
    });
  }

  function buildCadence() {
    (CFG.cadences || []).forEach(function (item) {
      var label = document.createElement("label");
      label.className = "radio";

      var input = document.createElement("input");
      input.type = "radio";
      input.name = "cadence";
      input.value = item.id;
      input.checked = !!item.default;

      var span = document.createElement("span");
      span.textContent = item.label;

      label.appendChild(input);
      label.appendChild(span);
      els.cadence.appendChild(label);
    });
  }

  /* ── live preview ────────────────────────────────────────────────────── */

  function refreshPreview() {
    var name = els.firstName.value.trim();
    var hood = normalizeHood(els.hood.value, els.city.value);

    setText("[data-preview-name]", name || "you");
    setText("[data-preview-hood]", hood || "neighborhood");
    setText("[data-preview-date]", (CFG.sendDay || "Thursday") + ", " + nextSendDate());
  }

  /* ── validation ──────────────────────────────────────────────────────── */

  function fieldWrap(name) {
    var err = document.querySelector('[data-err-for="' + name + '"]');
    return err ? err.closest(".field") : null;
  }

  function showError(name, message) {
    var err = document.querySelector('[data-err-for="' + name + '"]');
    if (!err) return;
    err.textContent = message;
    err.hidden = false;
    var wrap = fieldWrap(name);
    if (wrap) wrap.setAttribute("data-invalid", "");
  }

  function clearError(name) {
    var err = document.querySelector('[data-err-for="' + name + '"]');
    if (!err) return;
    err.hidden = true;
    err.textContent = "";
    var wrap = fieldWrap(name);
    if (wrap) wrap.removeAttribute("data-invalid");
  }

  function checkedInterests() {
    return Array.prototype.slice
      .call(els.interests.querySelectorAll("input:checked"))
      .map(function (i) { return i.value; });
  }

  function validate() {
    var problems = [];

    ["first_name", "email", "city", "neighborhood", "interests"]
      .forEach(clearError);

    if (!els.firstName.value.trim()) {
      showError("first_name", "We need something to call you.");
      problems.push(els.firstName);
    }

    var email = els.email.value.trim();
    if (!email) {
      showError("email", "An email would help.");
      problems.push(els.email);
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      showError("email", "That address doesn't look right.");
      problems.push(els.email);
    }

    if (!els.city.value) {
      showError("city", "Pick a city so we know where to look.");
      problems.push(els.city);
    }

    if (!els.hood.value.trim()) {
      showError("neighborhood", "Which neighborhood? Be specific.");
      problems.push(els.hood);
    }

    if (!checkedInterests().length) {
      showError("interests", "Pick at least one — otherwise there's nothing to send.");
      problems.push(els.interests);
    }

    return problems;
  }

  /* ── storage ─────────────────────────────────────────────────────────── */

  function supabaseReady() {
    var s = CFG.supabase || {};
    return Boolean(s.url && s.anonKey && s.table);
  }

  function saveLocally(record) {
    try {
      var key = "spotted:subscribers";
      var all = JSON.parse(localStorage.getItem(key) || "[]");
      all.push(record);
      localStorage.setItem(key, JSON.stringify(all));
    } catch (e) {
      /* private browsing, quota, etc. — the signup still "succeeds" visually */
    }
    console.info("[SPOTTED] Supabase not configured; stored locally:", record);
    return Promise.resolve({ duplicate: false });
  }

  /* Posts to the `subscribe` edge function rather than straight to the table.
     The function holds the service-role key, so it can write the row and send
     the confirmation email in one hop; the browser has no write access to
     the subscribers table at all. */
  function saveToSupabase(record) {
    var s = CFG.supabase;
    var endpoint = s.url.replace(/\/+$/, "") + "/functions/v1/subscribe";

    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": s.anonKey,
        "Authorization": "Bearer " + s.anonKey
      },
      body: JSON.stringify(record)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          throw new Error("subscribe " + res.status + ": " +
                          (data.error || "unknown") +
                          (data.fields ? " [" + data.fields.join(", ") + "]" : ""));
        }
        /* Already on the list is a good outcome, not an error. */
        return { duplicate: !!data.duplicate, emailed: !!data.emailed || !!data.resent };
      });
    });
  }

  /* ── submit ──────────────────────────────────────────────────────────── */

  function onSubmit(event) {
    event.preventDefault();
    status.hidden = true;

    var problems = validate();
    if (problems.length) {
      var first = problems[0];
      first.focus({ preventScroll: true });
      first.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    var cadenceInput = els.cadence.querySelector("input:checked");
    var hood = normalizeHood(els.hood.value, els.city.value);
    var city = cityById(els.city.value);

    var record = {
      first_name:     els.firstName.value.trim(),
      email:          els.email.value.trim().toLowerCase(),
      city:           city ? city.label : els.city.value,
      city_id:        els.city.value,
      neighborhood:   hood,
      street_address: els.street.value.trim() || null,
      interests:      checkedInterests(),
      cadence:        cadenceInput ? cadenceInput.value : "weekly",
      source:         "web"
    };

    submit.disabled = true;
    submit.textContent = "One second…";

    var save = supabaseReady() ? saveToSupabase(record) : saveLocally(record);

    save.then(function (result) {
      showDone(record, result.duplicate, result.emailed);
    }).catch(function (err) {
      console.error("[SPOTTED] signup failed:", err);
      submit.disabled = false;
      submit.textContent = "Put me on the list";
      status.hidden = false;
      status.textContent =
        "That didn't go through. Try again in a moment — or email us and " +
        "we'll add you by hand.";
    });
  }

  function showDone(record, duplicate, emailed) {
    setText("[data-done-name]", record.first_name);
    setText("[data-done-hood]", record.neighborhood);
    setText("[data-done-when]", (CFG.sendDay || "Thursday") + " morning, " +
                                nextSendDate());

    /* Only claim a confirmation email when one actually went out. */
    var confirmLine = document.querySelector("[data-done-confirm]");
    if (confirmLine && emailed) {
      setText("[data-done-email]", record.email);
      confirmLine.hidden = false;
    }

    if (duplicate) {
      var kicker = document.querySelector(".done__kicker");
      if (kicker) kicker.textContent = "You're already in.";
    }

    form.hidden = true;
    doneEl.hidden = false;
    doneEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* ── wire up ─────────────────────────────────────────────────────────── */

  function init() {
    setText("[data-brand]", CFG.brand || "SPOTTED");

    buildCities();
    buildInterests();
    buildCadence();
    refreshPreview();

    els.city.addEventListener("change", function () {
      buildHoodList(els.city.value);
      clearError("city");
      refreshPreview();
    });

    els.hood.addEventListener("input", function () {
      clearError("neighborhood");
      refreshPreview();
    });

    els.firstName.addEventListener("input", function () {
      clearError("first_name");
      refreshPreview();
    });

    els.email.addEventListener("input", function () { clearError("email"); });

    form.addEventListener("submit", onSubmit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
