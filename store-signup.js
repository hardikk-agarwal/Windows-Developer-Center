/* Microsoft Store — developer account flow (duplicate of the WDP signup, modified).
   Phase 1 "Create developer account" has 4 sub-steps; for the demo Continue SKIPS
   them and marks them complete, then jumps to Phase 2 "Publish your first app" — a
   nudge to create the first app. There is NO certificate step (the Store creates
   apps directly). The CTA seeds the Store portal (tdp.portal.store.v1, signed-in)
   and opens its Apps page. Demo only. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hashStr(s) { var h = 0, i; for (i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }
  function uid() { return "id-" + Math.abs(hashStr(String(Date.now()) + Math.random())).toString(36); }
  function initials(n) { var p = (n || "").trim().split(/\s+/);
    return (((p[0] || "")[0] || "") + ((p[1] || "")[0] || "") || "U").toUpperCase(); }

  var MSA = { name: "Alex Taylor", email: "alex.taylor@outlook.com", initials: "AT" };

  var PHASES = [
    { title: "Create developer account" },
    { title: "Publish your first app" }
  ];
  // Phase 1 keeps all 4 sub-steps for the rail; only "account" + "firstapp" render.
  var STEPS = [
    { key: "account",  phase: 0, title: "Account type",
      head: "Choose your account type", headSub: "Tell us whether you're publishing as an individual or a company." },
    { key: "identity", phase: 0, title: "Identity verification" },
    { key: "profile",  phase: 0, title: "Profile details" },
    { key: "setup",    phase: 0, title: "Account setup" },
    { key: "firstapp", phase: 1, title: "Create your first app",
      head: "Your Store developer account is ready", headSub: "One last step — create your first app and publish it to the Microsoft Store." }
  ];
  var LAST = STEPS.length - 1;

  var cur = 0, acctType = null;
  var store = { pubName: "", country: "United States", email: MSA.email };

  /* ---------- step rail (two phases, sub-steps nested) ---------- */
  function renderRail() {
    var html = "";
    for (var p = 0; p < PHASES.length; p++) {
      var idxs = []; for (var i = 0; i < STEPS.length; i++) if (STEPS[i].phase === p) idxs.push(i);
      var first = idxs[0], last = idxs[idxs.length - 1];
      var pDone = cur > last, pActive = cur >= first && cur <= last;
      var hCls = pDone ? "is-done" : pActive ? "is-active" : "";
      var num = pDone ? '<iconify-icon icon="fluent:checkmark-16-filled" width="16" height="16" aria-hidden="true"></iconify-icon>' : (p + 1);
      var subs = idxs.map(function (i) {
        var sDone = i < cur, sActive = i === cur;
        var sCls = sDone ? "is-done" : sActive ? "is-active" : "";
        var ind = sDone
          ? '<iconify-icon class="wsub__check" icon="fluent:checkmark-12-filled" width="12" height="12" aria-hidden="true"></iconify-icon>'
          : '<span class="wsub__dot"></span>';
        return '<div class="wsub ' + sCls + '">' + ind + '<span>' + STEPS[i].title + '</span></div>';
      }).join("");
      html += '<div class="wphase">' +
        '<div class="wstep ' + hCls + '"><span class="wstep__n">' + num + '</span>' +
          '<span class="wstep__t"><strong>' + PHASES[p].title + '</strong></span></div>' +
        '<div class="wsubs ' + (pDone ? "is-done" : "") + '">' + subs + '</div>' +
      '</div>';
    }
    $("wsteps").innerHTML = html;
  }

  /* ---------- step bodies ---------- */
  function bodyAccount() {
    function card(t, illo, title, p1) {
      return '<div class="acct-card' + (acctType === t ? ' is-selected' : '') + '" data-acct="' + t + '" role="button" tabindex="0" aria-pressed="' + (acctType === t) + '">' +
        '<iconify-icon class="acct-card__check" icon="fluent:checkmark-circle-16-filled" width="22" height="22" aria-hidden="true"></iconify-icon>' +
        '<div class="acct-card__illo"><img data-theme-image="' + illo.replace(/\.png$/, '') + '" src="assets/' + illo + '" alt="" /></div>' +
        '<h3>' + title + '</h3><p>' + p1 + '</p><span class="acct-free">Free</span></div>';
    }
    return '<div class="acct-grid">' +
      card("individual", "person.png", "Individual developer",
        "For hobbyists, students, and solo developers publishing under their own name.") +
      card("company", "building.png", "Company account",
        "For businesses and teams publishing under a company or organization name.") +
      '</div>';
  }

  function perksHTML() {
    function item(icon, title, desc) {
      return '<div class="wiz-next__item">' +
        '<iconify-icon icon="' + icon + '" width="22" height="22" aria-hidden="true"></iconify-icon>' +
        '<div><strong>' + title + '</strong><span>' + desc + '</span></div></div>';
    }
    return '<div class="wiz-next">' +
      '<p class="wiz-next__lead">In your developer portal, you can:</p>' +
      '<div class="wiz-next__grid">' +
        item("fluent:rocket-20-regular", "Publish apps", "Submit and update apps in the Store.") +
        item("fluent:data-trending-20-regular", "App analytics", "Track installs, ratings, and health.") +
        item("fluent:globe-20-regular", "Reach everywhere", "Distribute across 190+ markets.") +
      '</div></div>';
  }

  // Phase 2 — nudge to create the first app (hero banner + CTA to the Store portal).
  function bodyFirstApp() {
    return '<div class="status-card wiz-hero">' +
      '<img class="status-card__illo" data-theme-image="rocket" src="assets/rocket.png" alt="" />' +
      '<div class="status-card__body">' +
        '<span class="pill pill--ok"><span class="verified-dot"></span>Microsoft Store developer</span>' +
        '<h2>Bring your app to the Store</h2>' +
        '<p class="muted">Your developer account is active. Create your first app and reach over a billion Windows devices — no certificate required.</p>' +
      '</div>' +
      '<div class="status-card__action wiz-actions">' +
        '<fluent-button appearance="primary" id="goCreate"><iconify-icon slot="start" icon="fluent:add-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon>Create your first app</fluent-button>' +
        '<fluent-button appearance="outline" id="goPortal">Go to developer portal</fluent-button>' +
      '</div>' +
    '</div>' + perksHTML();
  }

  /* ---------- render ---------- */
  function render() {
    renderRail();
    var s = STEPS[cur], k = s.key;
    $("wizTitle").textContent = s.head;
    $("wizSub").textContent = s.headSub;
    $("wizBody").innerHTML = k === "account" ? bodyAccount() : bodyFirstApp();
    if (k === "account") {
      $("wizFootbar").innerHTML = '<span></span>' +
        '<fluent-button appearance="primary" id="wizNext"' + (acctType ? "" : " disabled") + '>Continue</fluent-button>';
    } else {
      $("wizFootbar").innerHTML = "";
    }
    wireStep();
  }

  // Demo: skip the account-creation sub-steps and jump straight to the first-app nudge.
  function next() {
    if (STEPS[cur].key !== "account" || !acctType) return;
    cur = LAST; render(); window.scrollTo(0, 0);
  }

  function wireStep() {
    var nb = $("wizNext"); if (nb) nb.addEventListener("click", next);
    if (STEPS[cur].key === "account") {
      $("wizBody").querySelectorAll("[data-acct]").forEach(function (el) {
        function pick() { acctType = el.getAttribute("data-acct"); render(); }
        el.addEventListener("click", pick);
        el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      });
    } else {
      var gc = $("goCreate"); if (gc) gc.addEventListener("click", openReserve);
      var gp = $("goPortal"); if (gp) gp.addEventListener("click", function () { seedStorePortal(); location.href = "store-portal.html#apps"; });
    }
  }

  // Land in the Store portal already signed in, on the Apps page (zero-state nudges
  // the user to create their first app).
  function seedStorePortal() {
    try {
      var KEY = "tdp.portal.store.v1", s;
      try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
      if (!s || !s.apps) s = { signedIn: false, account: null, verified: false, certs: [], apps: [] };
      s.signedIn = true; s.verified = true;
      s.account = { name: store.pubName || MSA.name, email: store.email || MSA.email, initials: initials(store.pubName || MSA.name) };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {}
  }

  /* ---------- reserve-name dialog (mirrors the Store portal's reserve dialog) ---------- */
  function openReserve() {
    if ($("pubName")) $("pubName").value = "";
    if ($("pubLang")) $("pubLang").value = "en-US";
    if ($("publishModal")) $("publishModal").hidden = false;
    document.addEventListener("keydown", escReserve);
    checkPubName();
    setTimeout(function () { try { $("pubName").focus(); } catch (e) {} }, 40);
  }
  function closeReserve() { if ($("publishModal")) $("publishModal").hidden = true; document.removeEventListener("keydown", escReserve); }
  function escReserve(e) { if (e.key === "Escape") closeReserve(); }
  function checkPubName() {
    var n = $("pubName"), hint = $("pubNameHint"), btn = $("pubCreate");
    if (!hint || !btn) return;
    var v = ((n && n.value) || "").trim();
    if (v.length < 2) {
      hint.className = "field__hint"; hint.textContent = "Enter an app name to reserve.";
      btn.setAttribute("disabled", ""); return;
    }
    hint.className = "field__hint field__hint--ok";
    hint.innerHTML = '<span class="verified-dot"></span>“' + esc(v) + '” is available';
    btn.removeAttribute("disabled");
  }
  // Reserve the name, then hand off to the Store portal, which creates the app and
  // opens the publishing flow (Back there lands on the Apps page).
  function createApp() {
    var n = $("pubName"); var name = ((n && n.value) || "").trim(); if (name.length < 2) return;
    var lang = ($("pubLang") && $("pubLang").value) || "en-US";
    seedStorePortal();
    location.href = "store-portal.html?create=" + encodeURIComponent(name) + "&lang=" + encodeURIComponent(lang) + "#apps";
  }
  function wireReserve() {
    var modal = $("publishModal"); if (!modal) return;
    modal.addEventListener("click", function (e) { if (e.target.closest("[data-pubclose]")) closeReserve(); });
    var create = $("pubCreate"); if (create) create.addEventListener("click", createApp);
    var n = $("pubName");
    if (n) {
      n.addEventListener("input", checkPubName);
      n.addEventListener("keyup", checkPubName);
      n.addEventListener("keydown", function (e) { if (e.key === "Enter" && $("pubCreate") && !$("pubCreate").hasAttribute("disabled")) { e.preventDefault(); createApp(); } });
    }
  }

  /* ---------- sign-in gate ---------- */
  function showWiz() { $("signin").hidden = true; $("wiz").hidden = false; render(); }
  $("msaTile").addEventListener("click", showWiz);
  var other = $("msaOther"); if (other) other.addEventListener("click", showWiz);
  wireReserve();
})();
