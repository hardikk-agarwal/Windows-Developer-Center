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
    app.store = true;                                    // portal table shows "✓ In Store"
    app.storeStatus = (msApp && msApp.status) || "in-review";
    if (msApp && msApp.name) app.storeName = msApp.name;  // name may have been edited in the flow
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
  function passCertification(done) {
    if (!done || done.hidden) return;
    done.__passed = true;
    var groups = LIVE_GROUPS.map(function (g) {
      return '<div class="live-card-list"><h3 class="live-card-list__title">' + esc(g.title) + '</h3>' +
        g.cards.map(liveCard).join("") + '</div>';
    }).join("");
    done.innerHTML = '<div class="live-hub">' + groups + '</div>';
    // Primary action ("View in Store") goes in the header's right-side action slot.
    var bar = document.getElementById("submit-bar");
    if (bar) {
      bar.innerHTML = '<fluent-button appearance="primary" size="large"><iconify-icon slot="start" icon="fluent:open-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon>View in Store</fluent-button>';
      bar.hidden = false;
    }
    var pill = document.getElementById("app-status");
    if (pill) { pill.textContent = "Published"; pill.className = "status-pill status-pill--published"; }
    try { var ms = readJSON(MS_KEY, []); var i = (Array.isArray(ms) ? ms : []).map(function (a) { return a.id; }).indexOf(id); if (i >= 0) { ms[i].status = "published"; localStorage.setItem(MS_KEY, JSON.stringify(ms)); } } catch (e) {}
    var s = readJSON(TDP_KEY, null);
    if (s && Array.isArray(s.apps)) { var ta = s.apps.filter(function (a) { return a.id === id; })[0]; if (ta) { ta.store = true; ta.storeStatus = "published"; try { localStorage.setItem(TDP_KEY, JSON.stringify(s)); } catch (e) {} } }
  }

  // doSubmit() reveals #state-done (hidden = false) once the app is submitted.
  function watch() {
    var done = document.getElementById("state-done");
    if (!done) return;
    function shown() {
      toggleSteps(true); syncBack();
      if (!done.__passed && !done.__certTimer) done.__certTimer = setTimeout(function () { passCertification(done); }, 5000);
    }
    function hidden() { toggleSteps(false); if (done.__certTimer) { clearTimeout(done.__certTimer); done.__certTimer = null; } }
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
    if (PORTAL_FILE === "store-portal.html") {            // match the Store developer portal chrome
      var bsub = document.querySelector(".brand__sub"); if (bsub) bsub.textContent = "Store Developer";
      document.querySelectorAll('a[href^="../portal.html"]').forEach(function (a) {
        a.setAttribute("href", a.getAttribute("href").replace("../portal.html", "../store-portal.html"));
      });
      var cnav = document.querySelector('a[href*="store-portal.html#certificates"]'); if (cnav) cnav.style.display = "none";
      if (stat) stat.innerHTML = '<span class="verified-dot"></span>Store developer';
      return;
    }
    if (stat) {
      var verified = st && st.verified;
      var hasValid = st && Array.isArray(st.certs) && st.certs.some(function (c) { return c.trust === "Valid"; });
      stat.innerHTML = !verified
        ? '<span class="verified-dot verified-dot--off"></span>Not verified'
        : (hasValid ? '<span class="verified-dot"></span>Verified Developer'
                    : '<span class="verified-dot verified-dot--warn"></span>Identity verified');
    }
  }

  // Use the app's real logo (the base64 icon the portal already has) in the flow's
  // app-identity banner, replacing the letter placeholder. Re-applied if v4 re-renders it.
  function applyLogo() {
    var el = document.getElementById("app-icon");
    if (!el) return;
    var st = readJSON(TDP_KEY, null);
    var app = st && Array.isArray(st.apps) ? st.apps.filter(function (a) { return a.id === id; })[0] : null;
    if (!app || !app.icon) return;
    var html = '<img src="data:image/png;base64,' + app.icon + '" alt="" style="width:100%;height:100%;object-fit:contain;display:block">';
    el.classList.add("tdp-has-icon"); // drop the placeholder box; show the icon directly
    el.innerHTML = html;
    if (!el.__tdpLogo) {
      el.__tdpLogo = true;
      new MutationObserver(function () {
        // Re-apply only when the icon reverted to the empty/initial placeholder; leave an
        // uploaded package's icon (the flow paints it as a background-image) in place.
        if (!el.querySelector("img") && !el.style.backgroundImage) { el.classList.add("tdp-has-icon"); el.innerHTML = html; }
      }).observe(el, { childList: true });
    }
  }

  // On reload, v4 shows the editor by default but the persisted status is still
  // in-review/published — restore the submitted view so the tag and panel agree
  // (no more "editor + In review tag" mismatch).
  function restoreSubmittedState() {
    var ms = readJSON(MS_KEY, []);
    var a = (Array.isArray(ms) ? ms : []).filter(function (x) { return x.id === id; })[0];
    var status = a && a.status;
    if (status !== "in-review" && status !== "published") return;
    var editor = document.getElementById("editor"), bar = document.getElementById("submit-bar"),
        done = document.getElementById("state-done");
    if (editor) editor.hidden = true;
    if (bar) bar.hidden = true;
    if (done) { done.hidden = false; if (status === "published") passCertification(done); }
  }
  function init() { populateHeader(); applyLogo(); restoreSubmittedState(); watch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
