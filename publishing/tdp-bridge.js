/* TDP bridge — reflects a completed publish (the v4 flow) back into the developer
   portal's app table.

   The portal seeds localStorage['msstore.apps'] (the shape v4 reads) before it
   navigates here. This script watches for submit completion and writes the result
   back into localStorage['tdp.portal.v5'] (the portal's state). Both pages are
   served from the same origin, so localStorage is shared. */
(function () {
  "use strict";
  var MS_KEY = "msstore.apps";
  var id = new URLSearchParams(location.search).get("id");
  if (!id) return;

  // Which portal launched this flow? Find the app in either variant's state and sync
  // back to that one (TDP portal is the default). No portal files are modified.
  var TDP_KEY = (function () {
    try {
      var s = JSON.parse(localStorage.getItem("tdp.portal.store.v1"));
      if (s && Array.isArray(s.apps) && s.apps.some(function (a) { return a.id === id; })) return "tdp.portal.store.v1";
    } catch (e) {}
    return "tdp.portal.v5";
  })();
  var PORTAL_FILE = TDP_KEY === "tdp.portal.store.v1" ? "store-portal.html" : "portal.html";

  function readJSON(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }
    catch (e) { return d; }
  }

  // Push the result of a successful submit back onto the matching portal app.
  function syncBack() {
    var state = readJSON(TDP_KEY, null);
    if (!state || !Array.isArray(state.apps)) return;
    var app = state.apps.filter(function (a) { return a.id === id; })[0];
    if (!app) return;
    var ms = readJSON(MS_KEY, []);
    var msApp = (Array.isArray(ms) ? ms : []).filter(function (a) { return a.id === id; })[0];
    var status = (msApp && msApp.status) || "in-review";
    // Reflect the real submission status. A failed ("rejected") cert is NOT in the Store.
    if (status === "rejected") { app.store = false; app.storeStatus = "rejected"; }
    else if (status === "published") { app.store = true; app.storeStatus = "published"; }
    else { app.store = true; app.storeStatus = status; }   // in-review
    if (msApp && msApp.name) app.storeName = msApp.name;  // name may have been edited in the flow
    if (msApp && msApp.icon) app.icon = msApp.icon;       // reflect the flow's final logo (MSIX package/manual upload) in the portal Apps table
    if (!app.storeCreated) {
      app.storeCreated = new Date().toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
    }
    try { localStorage.setItem(TDP_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function appName() {
    var el = document.getElementById("app-name");
    if (el && el.textContent.trim()) return el.textContent.trim();
    var ms = readJSON(MS_KEY, []); var a = (Array.isArray(ms) ? ms : []).filter(function (x) { return x.id === id; })[0];
    return (a && a.name) || "Your app";
  }
  // Hide the wizard step tabs while in review; restore them on withdraw.
  function toggleSteps(hide) {
    var s = document.getElementById("wz-steps"); if (s) s.style.display = hide ? "none" : "";
    // .wz-banner has padding-bottom:0 and relies on #wz-steps for its bottom spacing —
    // restore it when the tabs are hidden so the banner doesn't collapse.
    var banner = document.querySelector(".wz-banner"); if (banner) banner.style.paddingBottom = hide ? "var(--sp-20)" : "";
    // Bring back the portal's left nav once the app is in review/published.
    var appEl = document.querySelector(".app"); if (appEl) appEl.classList.toggle("has-rail", !!hide);
    var mode = document.querySelector(".ez-mode"); if (mode) mode.style.display = hide ? "none" : "";
  }

  // Demo: 5s after submit, certification "passes" — flip the panel to a published
  // state, set the header pill to Published, and persist that to portal + flow state.
  // A published app shows a live-app management hub — NOT the certification timeline.
  var LIVE_GROUPS = [
    { title: "Updates", cards: [
      ["fluent:arrow-upload-20-regular", "Update your app", "Submit a new package or version.", "#"],
      ["fluent:airplane-take-off-20-regular", "Package flights", "Ship preview builds to test rings.", "#"]
    ] },
    { title: "Insights & growth", cards: [
      ["fluent:data-histogram-20-regular", "View analytics", "Installs, usage, ratings and health.", "../" + PORTAL_FILE + "#analytics"],
      ["fluent:beaker-20-regular", "Product page experiments", "A/B test your Store listing.", "#"]
    ] },
    { title: "Listing & monetization", cards: [
      ["fluent:share-20-regular", "Share listing", "Copy your Store listing link.", "#"],
      ["fluent:puzzle-piece-20-regular", "Manage add-ons", "In-app products and subscriptions.", "#"]
    ] }
  ];
  function liveCard(c) {
    return '<a class="live-row" href="' + c[3] + '"><span class="live-card__ico"><iconify-icon icon="' + c[0] + '" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
      '<span class="live-card__t"><strong>' + esc(c[1]) + '</strong><span>' + esc(c[2]) + '</span></span>' +
      '<iconify-icon class="live-card__chev" icon="fluent:chevron-right-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon></a>';
  }
  // ---- Certification result data (plain language + Partner Center policy refs) ----
  // Each issue: what's wrong, how to fix, which step to jump to, and the policy number
  // (de-emphasised) for anyone who wants the official reference.
  // Issue data is shared with the standalone report page (see publishing/cert-issues.js).
  var CERT_ISSUES = window.CERT_ISSUES || [];

  // A single timeline stage (matches the in-progress card markup). `right` is the trailing slot.
  function stageHTML(state, bullet, title, desc, right) {
    var cls = state === "done" ? "cert-stage cert-stage--done"
            : state === "fail" ? "cert-stage cert-stage--fail"
            : state === "blocked" ? "cert-stage cert-stage--blocked" : "cert-stage";
    var b = bullet === "check" ? '<iconify-icon icon="fluent:checkmark-20-regular" width="14" height="14" aria-hidden="true"></iconify-icon>'
          : bullet === "x" ? '<iconify-icon icon="fluent:dismiss-20-regular" width="14" height="14" aria-hidden="true"></iconify-icon>'
          : esc(bullet);
    return '<div class="' + cls + '">' +
      '<span class="cert-stage__bullet">' + b + '</span>' +
      '<div class="cert-stage__body"><p class="cert-stage__title">' + esc(title) + '</p><p class="cert-stage__desc">' + esc(desc) + '</p></div>' +
      (right || "") +
    '</div>';
  }

  function failHTML() {
    var name = appName();
    var n = CERT_ISSUES.length;
    var word = n === 1 ? "issue" : "issues";
    var stages =
      stageHTML("done", "check", "Submission", "Your package and details were received.", '<span class="cert-stage__time">Done</span>') +
      stageHTML("done", "check", "Pre-processing", "Malware scan, certificate validation, manifest review.", '<span class="cert-stage__time">Passed</span>') +
      stageHTML("fail", "x", "Certification", "Manual review against Store policies and age rating.", '<span class="cert-stage__pill cert-stage__pill--fail"><iconify-icon icon="fluent:error-circle-16-regular" width="12" height="12" aria-hidden="true"></iconify-icon>' + n + ' ' + word + '</span>') +
      stageHTML("blocked", "4", "Publishing", "Resumes once you\u2019ve fixed the issues and resubmitted.", '<span class="cert-stage__pill cert-stage__pill--hold">On hold</span>');
    return '<div class="cert-card cert-card--fail">' +
      '<div class="cert-card__head">' +
        '<span class="cert-card__icon cert-card__icon--fail"><iconify-icon icon="fluent:error-circle-20-filled" width="28" height="28" aria-hidden="true"></iconify-icon></span>' +
        '<div>' +
          '<h2 class="cert-card__title">Certification didn\u2019t pass</h2>' +
          '<p class="cert-card__sub">We reviewed <strong>' + esc(name) + '</strong> and found ' + n + ' ' + word + ' during certification. Open the report for the details, then edit &amp; fix.</p>' +
        '</div>' +
      '</div>' +
      '<div class="cert-stages">' + stages + '</div>' +
    '</div>';
  }

  function passHTML() {
    var groups = LIVE_GROUPS.map(function (g) {
      return '<div class="live-card-list"><h3 class="live-card-list__title">' + esc(g.title) + '</h3>' +
        g.cards.map(liveCard).join("") + '</div>';
    }).join("");
    return '<div class="cert-pass">' +
      '<span class="cert-pass__badge"><iconify-icon icon="fluent:checkmark-circle-20-filled" width="22" height="22" aria-hidden="true"></iconify-icon></span>' +
      '<div class="cert-pass__text">' +
        '<strong class="cert-pass__title">Certification passed</strong>' +
        '<span class="cert-pass__sub"><strong>' + esc(appName()) + '</strong> is now live in the Microsoft Store.</span>' +
      '</div>' +
    '</div>' +
    '<div class="live-hub">' + groups + '</div>';
  }

  // ---- Certification result view state machine ----
  var certTimer = null;
  var nextOutcome = "passed";   // default result after a submit; the preview switcher (or an edit) can force the other outcome
  function $id(x) { return document.getElementById(x); }
  function clearCertTimer() { if (certTimer) { clearTimeout(certTimer); certTimer = null; } }
  function setSwitch(view) {
    var opts = document.querySelectorAll("#cert-switch .cert-switch__opt");
    Array.prototype.forEach.call(opts, function (b) { b.classList.toggle("is-active", b.getAttribute("data-cert-view") === view); });
  }
  function setPill(text, cls) { var p = $id("app-status"); if (p) { p.textContent = text; p.className = "status-pill status-pill--" + cls; } }
  // The submission-notification banner is only relevant while a submission is pending;
  // hide it once the app is published. (Class selector beats [hidden], so toggle display.)
  function setNotify(show) { var n = document.querySelector("#state-done .notify-banner"); if (n) n.style.display = show ? "" : "none"; }
  // App-header card's contextual action: Withdraw while in review, View in Store once published.
  function setHeadActions(view) {
    var w = $id("head-withdraw-btn"), v = $id("head-viewstore-btn"), r = $id("head-report-btn"), e = $id("head-editfix-btn");
    if (w) w.hidden = (view !== "progress");
    if (v) v.hidden = (view !== "passed");
    if (r) r.hidden = (view !== "failed");
    if (e) e.hidden = (view !== "failed");
  }
  function setMsStatus(status) {
    try { var ms = readJSON(MS_KEY, []); var i = (Array.isArray(ms) ? ms : []).map(function (a) { return a.id; }).indexOf(id); if (i >= 0) { ms[i].status = status; localStorage.setItem(MS_KEY, JSON.stringify(ms)); } } catch (e) {}
  }
  function setPortalStore(store, storeStatus) {
    var s = readJSON(TDP_KEY, null);
    if (s && Array.isArray(s.apps)) { var ta = s.apps.filter(function (a) { return a.id === id; })[0]; if (ta) { ta.store = store; ta.storeStatus = storeStatus; try { localStorage.setItem(TDP_KEY, JSON.stringify(s)); } catch (e) {} } }
  }

  function showProgress() {
    var done = $id("state-done"); if (done) done.__result = "progress";
    var prog = $id("cert-progress"), res = $id("cert-result"), act = $id("cert-actions");
    if (prog) prog.hidden = false;
    if (res) { res.hidden = true; res.innerHTML = ""; }
    if (act) act.hidden = false;
    var bar = $id("submit-bar"); if (bar) bar.hidden = true;
    setPill("In review", "in-review");
    setNotify(true);
    setHeadActions("progress");
    setSwitch("progress");
  }
  function showPassed() {
    var done = $id("state-done"); if (done) done.__result = "passed";
    var prog = $id("cert-progress"), res = $id("cert-result"), act = $id("cert-actions");
    if (prog) prog.hidden = true;
    if (res) { res.hidden = false; res.innerHTML = passHTML(); }
    if (act) act.hidden = true;
    var bar = $id("submit-bar"); if (bar) bar.hidden = true;
    setPill("Published", "published");
    setMsStatus("published"); setPortalStore(true, "published");
    setNotify(false);   // published: the submission-notification banner no longer applies
    setHeadActions("passed");
    setSwitch("passed");
  }
  function showFailed() {
    var done = $id("state-done"); if (done) done.__result = "failed";
    var prog = $id("cert-progress"), res = $id("cert-result"), act = $id("cert-actions");
    if (prog) prog.hidden = true;
    if (res) { res.hidden = false; res.innerHTML = failHTML(); }
    if (act) act.hidden = true;
    var bar = $id("submit-bar"); if (bar) bar.hidden = true;
    setPill("Action needed", "rejected");
    setMsStatus("rejected"); setPortalStore(false, "rejected");
    setNotify(true);
    setHeadActions("failed");
    setSwitch("failed");
  }
  function resolveTo(view) { clearCertTimer(); if (view === "passed") showPassed(); else if (view === "failed") showFailed(); else showProgress(); }
  function armCertTimer() { clearCertTimer(); certTimer = setTimeout(function () { resolveTo(nextOutcome); }, 4500); }

  // From the report: go back to the editor to fix issues, then aim the next result at "passed".
  function certGoToSection(section) {
    section = section || "step-listing";
    try { if (typeof window.setActiveSection === "function") window.setActiveSection(section); } catch (e) {}
    var rail = document.querySelector('.ez-rail__item[data-section="' + section + '"]');
    if (rail) { try { rail.click(); } catch (e) {} }
    var el = document.getElementById(section);
    if (el) { try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} } }
  }
  function goEditAndFix(section) {
    section = section || "step-listing";
    nextOutcome = "passed";
    var wb = $id("withdraw-btn"); if (wb) { try { wb.click(); } catch (e) {} }   // return to editor (wired in publish.html)
    setTimeout(function () {
      // Fold the certification issues into the existing header checklist so the developer can
      // click it any time to recall exactly what's left — no big panel taking over the editor.
      try { if (typeof window.certFixActivate === "function") window.certFixActivate(); } catch (e) {}
      certGoToSection(section);
    }, 90);
  }

  // Wire the preview switcher + the report's Fix / Edit buttons (once each).
  function wireCertControls() {
    var sw = $id("cert-switch");
    if (sw && !sw.__wired) {
      sw.__wired = true;
      sw.addEventListener("click", function (e) {
        var b = e.target.closest("[data-cert-view]"); if (!b) return;
        var v = b.getAttribute("data-cert-view");
        clearCertTimer();
        if (v === "passed") { nextOutcome = "passed"; showPassed(); }
        else if (v === "failed") { nextOutcome = "failed"; showFailed(); }
        else { showProgress(); }
      });
    }
    var res = $id("cert-result");
    if (res && !res.__wired) {
      res.__wired = true;
      res.addEventListener("click", function (e) {
        var report = e.target.closest("[data-cert-report]");
        if (report) { e.preventDefault(); window.open("cert-report.html?id=" + encodeURIComponent(id), "_blank", "noopener"); return; }
        var edit = e.target.closest("[data-edit]");
        if (edit) { e.preventDefault(); goEditAndFix("step-listing"); return; }
        var fix = e.target.closest("[data-fix]");
        if (fix) { e.preventDefault(); goEditAndFix(fix.getAttribute("data-fix")); }
      });
    }
    // Failed-state header actions (they live in the app-header card, not the cert body).
    var hr = $id("head-report-btn");
    if (hr && !hr.__wired) { hr.__wired = true; hr.addEventListener("click", function () { window.open("cert-report.html?id=" + encodeURIComponent(id), "_blank", "noopener"); }); }
    var he = $id("head-editfix-btn");
    if (he && !he.__wired) { he.__wired = true; he.addEventListener("click", function () { goEditAndFix("step-listing"); }); }
  }

  // doSubmit() reveals #state-done (hidden = false) once the app is submitted.
  function watch() {
    var done = document.getElementById("state-done");
    if (!done) return;
    wireCertControls();
    function shown() {
      toggleSteps(true); syncBack();
      // If a terminal result was already restored (passed/failed), keep it. Otherwise show
      // the in-progress timeline and let it resolve to the next outcome after a short beat.
      if (done.__result !== "passed" && done.__result !== "failed") { showProgress(); armCertTimer(); }
    }
    function hidden() { toggleSteps(false); clearCertTimer(); done.__result = null; }
    if (!done.hidden) shown();
    new MutationObserver(function () { if (!done.hidden) shown(); else hidden(); })
      .observe(done, { attributes: true, attributeFilter: ["hidden"] });
  }

  // Populate the shared portal header (avatar + account name + verified status) from the
  // portal's own state, mirroring portal.js renderAccount().
  function populateHeader() {
    var st = readJSON(TDP_KEY, null);
    var acct = (st && st.account) || { name: "Your organization", initials: "—" };
    var av = document.getElementById("avatar"),
        nm = document.getElementById("accountName"),
        stat = document.getElementById("accountStatus");
    if (av) av.textContent = acct.initials || "—";
    if (nm) nm.textContent = acct.name || "Your organization";
    if (PORTAL_FILE === "store-portal.html") {            // opened from the Store portal
      // Header brand stays unified as "Windows Developer Portal" (set by wdp-header.js) — one portal.
      document.querySelectorAll('a[href^="../portal.html"]').forEach(function (a) {
        a.setAttribute("href", a.getAttribute("href").replace("../portal.html", "../store-portal.html"));
      });
      if (stat) stat.innerHTML = '<span class="verified-dot"></span>Store developer';
      return;
    }
    if (stat) {
      var verified = st && st.verified;
      var hasValid = st && Array.isArray(st.certs) && st.certs.some(function (c) { return c.trust === "Valid"; });
      stat.innerHTML = !verified
        ? '<span class="verified-dot verified-dot--off"></span>No certificate'
        : (hasValid ? '<span class="verified-dot"></span>Program member'
                    : '<span class="verified-dot verified-dot--warn"></span>Self-signed certificate');
    }
  }

  // Use the app's real logo (the base64 icon the portal already has) in the flow's
  // app-identity banner, replacing the letter placeholder. Re-applied if v4 re-renders it.
  // The publish flow itself now owns the app-header icon: it follows the CURRENT package (or an
  // in-session logo upload) and reverts to the name placeholder when there's none. We deliberately
  // do NOT inject the portal's saved icon here — otherwise a hard refresh (packages are session-
  // only, so none are loaded) would keep showing a logo that belongs to a package that's gone.
  function applyLogo() { /* intentionally a no-op — see note above */ }

  // On reload, v4 shows the editor by default but the persisted status is still
  // in-review/published — restore the submitted view so the tag and panel agree
  // (no more "editor + In review tag" mismatch).
  function restoreSubmittedState() {
    var ms = readJSON(MS_KEY, []);
    var a = (Array.isArray(ms) ? ms : []).filter(function (x) { return x.id === id; })[0];
    var status = a && a.status;
    if (status !== "in-review" && status !== "published" && status !== "rejected") return;
    var editor = document.getElementById("editor"), bar = document.getElementById("submit-bar"),
        done = document.getElementById("state-done");
    if (editor) editor.hidden = true;
    if (bar) bar.hidden = true;
    if (done) {
      done.hidden = false;
      wireCertControls();
      if (status === "published") showPassed();
      else if (status === "rejected") showFailed();
      // in-review: watch()'s shown() shows the in-progress timeline and arms the resolve timer.
    }
  }
  function init() { populateHeader(); applyLogo(); restoreSubmittedState(); watch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
