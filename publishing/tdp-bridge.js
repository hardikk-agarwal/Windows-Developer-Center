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

  // Which portal launched this flow? Find the app in whichever portal state holds it and sync
  // back to THAT one. The unified portal (developer-portal.html) is the current default; the
  // store.v1 / v5 keys are legacy portals kept working for older entry points.
  var TDP_KEY = (function () {
    var keys = ["tdp.portal.unified.v1", "tdp.portal.store.v1", "tdp.portal.v5"];
    for (var i = 0; i < keys.length; i++) {
      try {
        var s = JSON.parse(localStorage.getItem(keys[i]));
        if (s && Array.isArray(s.apps) && s.apps.some(function (a) { return a.id === id; })) return keys[i];
      } catch (e) {}
    }
    return "tdp.portal.unified.v1";
  })();
  var PORTAL_FILE = TDP_KEY === "tdp.portal.store.v1" ? "store-portal.html"
    : TDP_KEY === "tdp.portal.v5" ? "portal.html"
    : "developer-portal.html";
  window.__portalFile = PORTAL_FILE;   // let the page's breadcrumb/back-arrow route "up to Apps" to the SAME portal the rail does

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
    if (hide) { try { renderAppNav(); } catch (e) {} }   // sidebar hidden via has-rail when !hide, so nothing to clear
    var mode = document.querySelector(".ez-mode"); if (mode) mode.style.display = hide ? "none" : "";
  }

  // ---- Contextual app rail: inside an app the left sidebar STOPS being the account rail and BECOMES
  //      this app's navigation — "All apps" (up a level) + the app identity + Overview + the app's
  //      capability sections, grouped exactly like the hub (LIVE_GROUPS = single source of truth) so the
  //      rail and the hub never drift. The sidebar lives outside #flow-wrap, so it persists across every
  //      L2 sub-view; each item reuses the hub card's handler (startAppUpdate/startExperiments/…). ----
  function appNavIconHTML() {
    var src = document.getElementById("app-icon");
    if (src) {
      // Prefer an <img>; else pull the URL out of the header's inline background-image. Reading
      // style.backgroundImage yields url("...") WITH quotes — inlining that into a style attr breaks
      // the HTML, so render an <img> from the extracted URL instead.
      var img = src.querySelector("img");
      if (img && img.getAttribute("src")) return '<span class="appnav__icon"><img src="' + esc(img.getAttribute("src")) + '" alt="" /></span>';
      var m = (src.style.backgroundImage || "").match(/url\((['"]?)(.*?)\1\)/);
      if (m && m[2]) return '<span class="appnav__icon"><img src="' + esc(m[2]) + '" alt="" /></span>';
    }
    var initial = (appName().replace(/^\s+/, "")[0] || "A").toUpperCase();
    return '<span class="appnav__icon appnav__icon--tile">' + esc(initial) + '</span>';
  }
  // Which section is on screen right now (drives the highlight) — derived from the same signals the
  // page back-arrow reads, so hub cards, the sidebar and the back-arrow always agree.
  function appNavSection() {
    try {
      var ex = document.getElementById("experiments-panel"); if (ex && !ex.hidden) return "experiments";
      var ad = document.getElementById("addons-panel"); if (ad && !ad.hidden) return "addons";
      var fl = document.getElementById("flights-panel"); if (fl && !fl.hidden) return "flights";
      var nm = document.getElementById("names-panel"); if (nm && !nm.hidden) return "names";
      var pm = document.getElementById("promo-panel"); if (pm && !pm.hidden) return "promo";
      var idn = document.getElementById("identity-panel"); if (idn && !idn.hidden) return "identity";
      var av = document.getElementById("availability-panel"); if (av && !av.hidden) return "availability";
      var hi = document.getElementById("history-panel"); if (hi && !hi.hidden) return "history";
      if (window.__inUpdateFlow) return "update";
    } catch (e) {}
    return "overview";
  }
  function setAppNavActive(k) {
    var host = document.getElementById("app-rail"); if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll("[data-app-nav]"), function (a) {
      a.classList.toggle("is-active", a.getAttribute("data-app-nav") === k);
    });
  }
  window.__setAppNavActive = setAppNavActive;
  // An update is certifying (in review) — used to block/label a second update everywhere.
  function updateInProgress() {
    var done = document.getElementById("state-done");
    if (done && done.__result === "progress") return true;
    var pill = document.getElementById("app-status");
    return !!(pill && pill.textContent.trim() === "In review");
  }
  // ---- App switcher: the rail's identity header doubles as a quick-switch between THIS developer's
  //      apps (Play Console / App Store Connect idiom) so you never have to bounce back to the Apps
  //      list to jump apps. Only shown when there's more than one app. ----
  function appList() {
    var st = readJSON(TDP_KEY, null);
    var apps = (st && Array.isArray(st.apps)) ? st.apps : [];
    return apps.map(function (a) {
      return { id: a.id, name: (a.storeName || a.name || "Untitled app"), icon: a.icon || null,
               status: a.storeStatus || a.status || (a.store ? "published" : "") };
    });
  }
  // Preserve the entry context (?from=…) when switching apps; only swap the id (drop the cache-buster).
  function switchUrl(newId) {
    var qs = new URLSearchParams(location.search); qs.set("id", newId); qs.delete("_cb");
    return location.pathname + "?" + qs.toString();
  }
  var STATUS_LABEL = { published: "Live", "in-review": "In review", rejected: "Needs attention", "in-progress": "Draft" };
  function appSwitchIconHTML(a) {
    if (a.icon) { var src = /^(data:|https?:|\/)/.test(a.icon) ? a.icon : "data:image/png;base64," + a.icon; return '<span class="app-switch__ico"><img src="' + esc(src) + '" alt="" /></span>'; }
    var initial = ((a.name || "A").replace(/^\s+/, "")[0] || "A").toUpperCase();
    return '<span class="app-switch__ico app-switch__ico--tile">' + esc(initial) + '</span>';
  }
  function renderAppSwitchMenu(apps) {
    var menu = document.getElementById("app-switch-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "app-switch-menu"; menu.className = "app-switch__menu"; menu.setAttribute("role", "listbox"); menu.hidden = true;
      document.body.appendChild(menu);
      menu.addEventListener("click", function (e) {
        var opt = e.target.closest("[data-switch-id]"); if (!opt) return;
        var nid = opt.getAttribute("data-switch-id");
        if (nid && nid !== id) { location.href = switchUrl(nid); } else { closeAppSwitch(); }
      });
    }
    menu.innerHTML = '<div class="app-switch__hdr">Your apps</div>' +
      apps.map(function (a) {
        var cur = a.id === id, st = STATUS_LABEL[a.status] || "";
        return '<button type="button" role="option" class="app-switch__opt' + (cur ? " is-current" : "") + '" data-switch-id="' + esc(a.id) + '"' + (cur ? ' aria-selected="true"' : '') + '>' +
          appSwitchIconHTML(a) +
          '<span class="app-switch__metatext"><span class="app-switch__optname">' + esc(cur ? appName() : a.name) + '</span>' + (st ? '<span class="app-switch__status">' + esc(st) + '</span>' : '') + '</span>' +
          (cur ? '<iconify-icon class="app-switch__check" icon="fluent:checkmark-16-filled" width="16" height="16" aria-hidden="true"></iconify-icon>' : '') +
        '</button>';
      }).join("");
  }
  function switchBtn() { return document.querySelector("#app-rail [data-app-switch]"); }
  function positionAppSwitch() {
    var menu = document.getElementById("app-switch-menu"), btn = switchBtn(); if (!menu || !btn) return;
    var r = btn.getBoundingClientRect();
    menu.style.left = Math.round(r.left) + "px"; menu.style.top = Math.round(r.bottom + 6) + "px"; menu.style.minWidth = Math.round(r.width) + "px";
  }
  function onAppSwitchOutside(e) { if (e.target.closest("#app-switch-menu") || e.target.closest("[data-app-switch]")) return; closeAppSwitch(); }
  function onAppSwitchKey(e) { if (e.key === "Escape") { closeAppSwitch(); var b = switchBtn(); if (b) b.focus(); } }
  function openAppSwitch() {
    renderAppSwitchMenu(appList());   // rebuild fresh every open → live names (incl. the current app) + current status
    var menu = document.getElementById("app-switch-menu"), btn = switchBtn(); if (!menu || !btn) return;
    positionAppSwitch(); menu.hidden = false; btn.setAttribute("aria-expanded", "true");
    setTimeout(function () {
      document.addEventListener("click", onAppSwitchOutside, true);
      document.addEventListener("keydown", onAppSwitchKey, true);
      window.addEventListener("resize", positionAppSwitch);
      var sc = document.querySelector(".sidebar__top"); if (sc) sc.addEventListener("scroll", positionAppSwitch);
    }, 0);
  }
  function closeAppSwitch() {
    var menu = document.getElementById("app-switch-menu"), btn = switchBtn();
    if (menu) menu.hidden = true; if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onAppSwitchOutside, true);
    document.removeEventListener("keydown", onAppSwitchKey, true);
    window.removeEventListener("resize", positionAppSwitch);
    var sc = document.querySelector(".sidebar__top"); if (sc) sc.removeEventListener("scroll", positionAppSwitch);
  }
  function renderAppNav() {
    var host = document.getElementById("app-rail"); if (!host) return;
    var done = document.getElementById("state-done");
    // Capability sections only make sense once a live version exists (published, or an update in
    // review/failed over a live app). A first submission still in review shows just the essentials.
    var live = (done && done.__result === "passed") || submissionIsUpdate;
    var active = appNavSection();
    var updBusy = updateInProgress();
    function navItem(icon, label, key) {
      var busy = (key === "update") && updBusy;   // an update is certifying — can't stack another
      return '<a href="#" data-app-nav="' + key + '" class="' + (key === active ? "is-active" : "") + (busy ? " is-disabled" : "") + '"' + (busy ? ' aria-disabled="true" title="An update is already in review"' : '') + '>' +
        '<iconify-icon icon="' + icon + '" width="20" height="20" aria-hidden="true"></iconify-icon><span class="app-rail__label">' + esc(label) + '</span>' + (busy ? '<span class="appnav__badge">In review</span>' : '') + '</a>';
    }
    // Up a level: back to the portal's Apps list. The account rail (Overview/Analytics/…) lives there.
    // App identity — which app you're inside. With >1 app it doubles as a quick-switch (chevron + menu).
    // "All apps": persistent up-link to the portal's Apps list. The rail owns it because it is always
    // visible; the page breadcrumb scrolls off on long pages, so it cannot be the only way back.
    var back = '<a class="app-rail__back" href="../' + PORTAL_FILE + '#apps"><iconify-icon icon="fluent:arrow-left-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon><span class="app-rail__label">All apps</span></a>';
    var apps = appList(), multi = apps.length > 1;
    var idRow = multi
      ? '<button type="button" class="app-rail__id app-rail__id--btn" data-app-switch aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(appName()) + ' — switch app">' + appNavIconHTML() + '<span class="app-rail__name">' + esc(appName()) + '</span><iconify-icon class="app-rail__chev" icon="fluent:chevron-down-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon></button>'
      : '<div class="app-rail__id">' + appNavIconHTML() + '<span class="app-rail__name">' + esc(appName()) + '</span></div>';
    var overview = navItem("fluent:home-20-regular", "Overview", "overview");
    // Sidebar nav groups — a nav-specific order (independent of the hub cards). Share is a header action now.
    var groups = "";
    if (live) {
      var RAIL_GROUPS = [
        ["Updates", [
          ["fluent:arrow-upload-20-regular", "Update your app", "update"],
          ["fluent:airplane-take-off-20-regular", "Package flights", "flights"],
          ["fluent:puzzle-piece-20-regular", "Manage add-ons", "addons"],
          ["fluent:beaker-20-regular", "Product page experiments", "experiments"]
        ]],
        ["Manage", [
          ["fluent:document-text-20-regular", "Package identity", "identity"],
          ["fluent:history-20-regular", "View submissions", "history"],
          ["fluent:tag-multiple-20-regular", "Manage app names", "names"],
          ["fluent:ticket-diagonal-20-regular", "Promo codes", "promo"],
          ["fluent:eye-20-regular", "Store availability", "availability"]
        ]]
      ];
      groups = RAIL_GROUPS.map(function (g) {
        var rows = g[1].map(function (it) { return navItem(it[0], it[1], it[2]); }).join("");
        return '<div class="app-rail__group"><span class="app-rail__ghdr">' + esc(g[0]) + '</span>' + rows + '</div>';
      }).join("");
    } else {
      // First submission still in review/failed (not live yet): show only what's usable before you're
      // live — name reservations + the manifest identity reference. Everything else unlocks once
      // published (previewed in the Overview's "Once you're live" teaser), so it stays hidden, not greyed.
      groups = '<div class="app-rail__group">' +
        navItem("fluent:tag-multiple-20-regular", "Manage app names", "names") +
        navItem("fluent:document-text-20-regular", "Package identity", "identity") +
        '</div>';
    }
    host.innerHTML = back + idRow + '<div class="app-rail__sep"></div>' + overview + groups;
    if (!multi) { closeAppSwitch(); }   // single app → no switcher; hide any stale menu. Multi builds lazily on open.
    if (!host.__wired) {
      host.__wired = true;
      host.addEventListener("click", function (e) {
        if (e.target.closest("[data-app-switch]")) {   // the identity header → toggle the app switcher
          e.preventDefault();
          var menu = document.getElementById("app-switch-menu");
          if (menu && !menu.hidden) { closeAppSwitch(); } else { openAppSwitch(); }
          return;
        }
        var a = e.target.closest("[data-app-nav]"); if (!a) return; e.preventDefault();
        if (a.classList.contains("is-disabled")) return;   // e.g. Update while one is still in review
        var k = a.getAttribute("data-app-nav");
        // Every capability is an L3 page (panel) now: exit any open sub-view back to the hub FIRST so
        // panels don't nest, then open the target. (Store availability + Package identity became pages,
        // so the rail behaves identically for every item.)
        var subviews = { update: "startAppUpdate", experiments: "startExperiments", addons: "startAddons", flights: "startFlights", names: "startNames", identity: "startIdentity", availability: "startAvailability", promo: "startPromo", history: "startHistory" };
        if (k === "overview") { if (typeof window.__appHome === "function") window.__appHome(); }
        else if (k === "share") { if (typeof window.startShareListing === "function") window.startShareListing(); }   // a dialog — opens over the current view
        else if (subviews[k]) {
          if (typeof window.__appHome === "function") window.__appHome();
          if (typeof window[subviews[k]] === "function") window[subviews[k]]();
        }
        else { return; }
        setAppNavActive(appNavSection());
      });
      try {
        var mo = new MutationObserver(function () { setAppNavActive(appNavSection()); });
        var fw = document.getElementById("flow-wrap"); if (fw) mo.observe(fw, { attributes: true, attributeFilter: ["class"] });
        ["experiments-panel", "addons-panel", "flights-panel", "names-panel", "identity-panel", "availability-panel", "history-panel", "promo-panel"].forEach(function (pid) { var p = document.getElementById(pid); if (p) mo.observe(p, { attributes: true, attributeFilter: ["hidden"] }); });
        // The heading (#app-name) is hydrated/renamed AFTER this first render, so mirror it live into
        // the rail identity — otherwise the rail can show a stale name (e.g. "Excel" vs "Excel Pro").
        var nameEl = document.getElementById("app-name");
        if (nameEl) {
          var syncRailName = function () { var n = document.querySelector("#app-rail .app-rail__name"); if (n) n.textContent = appName(); };
          new MutationObserver(syncRailName).observe(nameEl, { childList: true, characterData: true, subtree: true });
          syncRailName();
        }
      } catch (e) {}
    }
    try { mountDemoFab(); syncDemoFab(live); } catch (e) {}   // floating demo stage control, only while the live dashboard is up
  }

  // Demo: 5s after submit, certification "passes" — flip the panel to a published
  // state, set the header pill to Published, and persist that to portal + flow state.
  // A published app shows a live-app management hub — NOT the certification timeline.
  var LIVE_GROUPS = [
    { title: "Updates", accent: "brand", cards: [
      ["fluent:arrow-upload-20-regular", "Update your app", "Submit a new package or version.", "#", "update"],
      ["fluent:airplane-take-off-20-regular", "Package flights", "Ship preview builds to test rings.", "#", "flights"],
      ["fluent:tag-multiple-20-regular", "Manage app names", "Reserve names & set a name per language.", "#", "names"],
      ["fluent:document-text-20-regular", "Package identity", "Names & IDs for your AppxManifest.xml.", "#", "identity"]
    ] },
    { title: "Insights & growth", accent: "growth", cards: [
      ["fluent:beaker-20-regular", "Product page experiments", "A/B test your Store listing.", "#", "experiments"]
    ] },
    { title: "Listing & monetization", accent: "mon", cards: [
      ["fluent:share-20-regular", "Share your listing", "Get your Store link to share anywhere.", "#", "share"],
      ["fluent:puzzle-piece-20-regular", "Manage add-ons", "In-app products and subscriptions.", "#", "addons"],
      ["fluent:ticket-diagonal-20-regular", "Promo codes", "Give reviewers & fans free download codes.", "#", "promo"],
      ["fluent:eye-20-regular", "Store availability", "Control who can find and get your app.", "#", "availability"]
    ] }
  ];
  // Live-state pill for capability rows that carry a count (experiments / add-ons) — makes the
  // Overview cards INFORMATIVE (state the terse sidebar can't show), not just a duplicate menu.
  // Always shown (incl. an empty "None yet") so the state is visible even before anything is set up.
  function liveRowStat(action) {
    if (action === "experiments") { var e = dashCount("tdp.experiments."); return '<span class="live-row__stat' + (e ? '' : ' live-row__stat--none') + '">' + (e ? e + ' running' : 'None yet') + '</span>'; }
    if (action === "addons") { var a = dashCount("tdp.addons."); return '<span class="live-row__stat' + (a ? '' : ' live-row__stat--none') + '">' + (a ? a + ' active' : 'None yet') + '</span>'; }
    if (action === "flights") { var f = dashCount("tdp.flights."); return '<span class="live-row__stat' + (f ? '' : ' live-row__stat--none') + '">' + (f ? f + ' active' : 'None yet') + '</span>'; }
    return '';
  }
  function liveRow(c, opts) {
    // While an update is certifying, the "Update your app" row becomes a non-interactive status
    // chip — you can't stack a second submission on a pending one.
    if (opts && opts.updating && c[4] === "update") {
      return '<div class="live-row live-row--busy" aria-disabled="true"><span class="live-row__ico"><iconify-icon icon="fluent:clock-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
        '<span class="live-row__t"><strong>Update in review</strong><span>Your new version is being certified.</span></span></div>';
    }
    var act = c[4] ? ' data-live-action="' + c[4] + '"' : '';
    // Store availability carries live state (available / hidden from new customers), so its row shows
    // the current status rather than a static description.
    if (c[4] === "availability") {
      var un = availUnavailable();
      return '<a class="live-row live-row--availability' + (un ? ' is-unavailable' : '') + '" href="#" data-live-action="availability">' +
        '<span class="live-row__ico"><iconify-icon icon="' + (un ? 'fluent:eye-off-20-regular' : 'fluent:eye-20-regular') + '" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
        '<span class="live-row__t"><strong>Store availability</strong><span>' + (un ? 'Hidden from new customers' : 'Available to everyone') + '</span></span>' +
        (un ? '<span class="live-row__tag">Hidden</span>' : '') +
        '<iconify-icon class="live-row__chev" icon="fluent:chevron-right-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></a>';
    }
    return '<a class="live-row" href="' + c[3] + '"' + act + '><span class="live-row__ico"><iconify-icon icon="' + c[0] + '" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
      '<span class="live-row__t"><strong>' + esc(c[1]) + '</strong><span>' + esc(c[2]) + '</span></span>' +
      liveRowStat(c[4]) +
      '<iconify-icon class="live-row__chev" icon="fluent:chevron-right-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></a>';
  }
  // The management hub — the developer's home for a live app. Always present once shipped; only the
  // status card above it changes (live / update in review / needs attention).
  function hubHTML(opts) {
    var groups = LIVE_GROUPS.map(function (g) {
      return '<section class="live-group"><h3 class="live-group__title">' + esc(g.title) + '</h3>' +
        '<div class="live-panel">' + g.cards.map(function (c) { return liveRow(c, opts); }).join("") + '</div></section>';
    }).join("");
    return '<div class="live-hub">' + groups + '</div>';
  }
  // Live-state counts for the app-overview capability rows (experiments / add-ons).
  function dashCount(prefix) { try { var a = JSON.parse(localStorage.getItem(prefix + id) || "[]"); return Array.isArray(a) ? a.length : 0; } catch (e) { return 0; } }
  // Adaptive status card that answers "what's happening with my app right now?"
  function liveStatusCard() {
    return '<div class="app-status-card app-status-card--live">' +
      '<span class="app-status-card__ico"><iconify-icon icon="fluent:checkmark-circle-20-filled" width="24" height="24" aria-hidden="true"></iconify-icon></span>' +
      '<div class="app-status-card__body"><strong class="app-status-card__title">Live in the Microsoft Store</strong>' +
        '<span class="app-status-card__sub"><strong>' + esc(appName()) + '</strong> is published and available to customers.</span></div>' +
      '<span class="app-status-card__badge app-status-card__badge--live"><span class="asc-dot"></span>Live</span>' +
    '</div>';
  }
  // Win32 (.exe/.msi) apps skip Pre-processing, so their cert pipeline is 3 stages, not 4. The flow
  // records this on the app record (msstore.apps) at submit; window.__CERT_WIN32 mirrors it in the
  // same document. Default false (MSIX/PWA) when nothing is known — the original 4-stage behaviour.
  function certWin32() {
    try { if (typeof window.__CERT_WIN32 === "boolean") return window.__CERT_WIN32; } catch (e) {}
    try {
      var ms = readJSON(MS_KEY, []); var a = (Array.isArray(ms) ? ms : []).filter(function (x) { return x.id === id; })[0];
      if (a && (a.win32 === true || a.packageType === "win32")) return true;
    } catch (e) {}
    return false;
  }
  function reviewStatusCard() {
    var stages = certWin32()
      ? [["Submitted", "done"], ["Certification", "current"], ["Publishing", "todo"]]
      : [["Submitted", "done"], ["Pre-processing", "done"], ["Certification", "current"], ["Publishing", "todo"]];
    var strip = stages.map(function (s, i) {
      var dot = s[1] === "done" ? '<iconify-icon icon="fluent:checkmark-12-filled" width="11" height="11" aria-hidden="true"></iconify-icon>'
              : s[1] === "current" ? '<fluent-spinner size="tiny" aria-hidden="true"></fluent-spinner>'
              : String(i + 1);
      return '<span class="cert-strip__stage cert-strip__stage--' + s[1] + '"><span class="cert-strip__dot">' + dot + '</span><span class="cert-strip__lbl">' + s[0] + '</span></span>';
    }).join('<span class="cert-strip__sep" aria-hidden="true"></span>');
    return '<div class="app-status-card app-status-card--review">' +
      '<div class="app-status-card__head"><span class="app-status-card__ico"><fluent-spinner size="small" aria-hidden="true"></fluent-spinner></span>' +
        '<div class="app-status-card__body"><strong class="app-status-card__title">Update in review</strong>' +
          '<span class="app-status-card__sub">Your new version is being certified. Your live version stays up until it passes \u2014 we\u2019ll email you when it\u2019s done.</span></div>' +
        '<span class="app-status-card__badge app-status-card__badge--review"><span class="asc-dot"></span>In review</span></div>' +
      '<div class="cert-strip">' + strip + '</div>' +
    '</div>';
  }
  function attentionStatusCard() {
    var n = CERT_ISSUES.length; var word = n === 1 ? "issue" : "issues";
    return '<div class="app-status-card app-status-card--attention">' +
      '<div class="app-status-card__head"><span class="app-status-card__ico"><iconify-icon icon="fluent:error-circle-20-filled" width="24" height="24" aria-hidden="true"></iconify-icon></span>' +
        '<div class="app-status-card__body"><strong class="app-status-card__title">Your update needs attention</strong>' +
          '<span class="app-status-card__sub">We found ' + n + ' ' + word + ' in the new version. Your live app is unaffected \u2014 fix these and resubmit.</span></div>' +
        '<span class="app-status-card__badge app-status-card__badge--attention"><span class="asc-dot"></span>Action needed</span></div>' +
      '<div class="app-status-card__actions">' +
        '<fluent-button appearance="secondary" data-cert-report><iconify-icon slot="start" icon="fluent:document-text-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon>View report</fluent-button>' +
        '<fluent-button appearance="primary" data-fix="step-listing"><iconify-icon slot="start" icon="fluent:wrench-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon>Fix &amp; resubmit</fluent-button>' +
      '</div>' +
    '</div>';
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

  function failHTML(isUpdate) {
    var name = appName();
    var n = CERT_ISSUES.length;
    var word = n === 1 ? "issue" : "issues";
    var failToggle = '<button type="button" class="cert-card__toggle" aria-label="View steps"><span class="cert-card__toggle-txt">View steps</span><iconify-icon icon="fluent:chevron-down-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon></button>';
    var win32 = certWin32();
    var stripSteps = win32
      ? [["Submitted", "done"], ["Certification", "fail"], ["Publishing", "todo"]]
      : [["Submitted", "done"], ["Pre-processing", "done"], ["Certification", "fail"], ["Publishing", "todo"]];
    var stripInner = stripSteps.map(function (s, i) {
      var dot = s[1] === "done" ? '<iconify-icon icon="fluent:checkmark-12-filled" width="11" height="11" aria-hidden="true"></iconify-icon>'
              : s[1] === "fail" ? '<iconify-icon icon="fluent:dismiss-12-filled" width="11" height="11" aria-hidden="true"></iconify-icon>'
              : String(i + 1);
      return '<span class="cert-strip__stage cert-strip__stage--' + s[1] + '"><span class="cert-strip__dot">' + dot + '</span><span class="cert-strip__lbl">' + s[0] + '</span></span>';
    }).join('<span class="cert-strip__sep" aria-hidden="true"></span>');
    var failStrip = '<div class="cert-strip cert-strip--summary" aria-hidden="true">' + stripInner + '<span class="cert-strip__eta cert-strip__eta--fail">' + n + ' ' + word + '</span></div>';
    var stageDefs = win32
      ? [["done", "check", "Submission", "Package received"], ["fail", "x", "Certification", "Policy & age review"], ["blocked", "", "Publishing", "Sign-off & rollout"]]
      : [["done", "check", "Submission", "Package received"], ["done", "check", "Pre-processing", "Automated checks"], ["fail", "x", "Certification", "Policy & age review"], ["blocked", "", "Publishing", "Sign-off & rollout"]];
    var stages = stageDefs.map(function (d, i) {
      var right = d[0] === "fail" ? '<span class="cert-stage__pill cert-stage__pill--fail"><iconify-icon icon="fluent:error-circle-16-regular" width="12" height="12" aria-hidden="true"></iconify-icon>' + n + ' ' + word + '</span>'
                : d[0] === "blocked" ? '<span class="cert-stage__pill cert-stage__pill--hold">On hold</span>' : '';
      return stageHTML(d[0], d[1] || String(i + 1), d[2], d[3], right);
    }).join("");
    var failActions = '<div class="cert-card__headactions">' +
        '<fluent-button appearance="secondary" data-cert-report><iconify-icon slot="start" icon="fluent:document-text-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon>View report</fluent-button>' +
        '<fluent-button appearance="primary" data-fix="step-listing"><iconify-icon slot="start" icon="fluent:wrench-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon>Fix &amp; resubmit</fluent-button>' +
        (isUpdate ? failToggle : '') +
      '</div>';
    return '<div class="cert-card cert-card--fail' + (isUpdate ? ' is-collapsed cert-card--compact' : '') + '">' +
      '<div class="cert-card__head">' +
        '<span class="cert-card__icon cert-card__icon--fail"><iconify-icon icon="fluent:error-circle-20-filled" width="28" height="28" aria-hidden="true"></iconify-icon></span>' +
        '<div class="cert-card__headtext">' +
          '<h2 class="cert-card__title">' + (isUpdate ? "Your update needs attention" : "Certification didn\u2019t pass") + '</h2>' +
          '<p class="cert-card__sub">' + (isUpdate ? ('We found ' + n + ' ' + word + ' in the new version of <strong>' + esc(name) + '</strong>. Your live version is unaffected \u2014 fix these and resubmit.') : ('We reviewed <strong>' + esc(name) + '</strong> and found ' + n + ' ' + word + ' during certification. Open the report for the details, then edit &amp; fix.')) + '</p>' +
        '</div>' +
        failActions +
      '</div>' +
      (isUpdate ? failStrip : '') +
      '<div class="cert-stages">' + stages + '</div>' +
    '</div>';
  }

  // A just-published app has no telemetry yet — we still show the three metric cards with 0 / —
  // placeholders (per request) so the headline layout + analytics links are present from go-live.
  function appStatsData() {
    try { return JSON.parse(localStorage.getItem("tdp.appstats." + id) || "null"); } catch (e) { return null; }
  }
  function statFmt(n) { n = Math.round(n); if (n >= 1e6) return (+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)) + "M"; if (n >= 1e3) return (+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)) + "K"; return "" + n; }
  function liveStatCard(icon, label, value, mod, href) {
    var cls = "live-stat" + (mod ? " live-stat--" + mod : "") + (href ? " live-stat--link" : "");
    var inner = '<span class="live-stat__ico"><iconify-icon icon="' + icon + '" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
      '<div class="live-stat__body"><span class="live-stat__label">' + label + '</span><strong class="live-stat__value">' + value + '</strong></div>' +
      (href ? '<iconify-icon class="live-stat__chev" icon="fluent:chevron-right-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon>' : '');
    return href
      ? '<a class="' + cls + '" href="' + href + '" title="View ' + esc(label) + ' analytics">' + inner + '</a>'
      : '<div class="' + cls + '">' + inner + '</div>';
  }
  // Once live, show the SAME headline figures as the portal Apps table (persisted to tdp.appstats.<id>
  // by portal.js). Before any telemetry exists we STILL show the three metric cards (0 / — placeholders)
  // so the layout is stable and the analytics links are always available — no separate empty note.
  function liveStatsHTML() {
    var s = appStatsData() || {};
    var hasInstalls = s.installs != null, hasCrash = s.crashRate != null, hasRating = s.rating != null;
    var warn = hasCrash && (+s.crashRate) >= 5;
    // Each headline metric links to its own analytics tab (Installs → Acquisition, Crash rate →
    // Crash, Rating → Ratings), deep-linked to THIS app; the portal honours anaApp/anaTab on load.
    var anaHref = function (tab) { return "../" + PORTAL_FILE + "?anaApp=" + encodeURIComponent(id) + "&anaTab=" + tab + "#analytics"; };
    var installVal = hasInstalls ? statFmt(s.installs) : "0";
    var crashVal = hasCrash ? (+s.crashRate).toFixed(2) + "%" : "—";
    var ratingVal = hasRating ? (+s.rating).toFixed(1) + ' <small>(' + statFmt(s.ratingCount || 0) + ')</small>' : "—";
    return '<div class="live-metrics">' +
      liveStatCard("fluent:arrow-download-20-regular", "Installs", installVal, "", anaHref("acquisition")) +
      liveStatCard("fluent:pulse-20-regular", "Crash rate", crashVal, warn ? "warn" : "ok", anaHref("crashes")) +
      liveStatCard("fluent:star-20-regular", "Rating", ratingVal, "", anaHref("ratings")) +
    '</div>';
  }
  // The published "app overview": at-a-glance stats + the management hub. The app header already
  // carries the Published pill + "View in Store", so we don't repeat a separate green "Live" card here.
  function availUnavailable() { try { return localStorage.getItem("tdp.availability." + id) === "unavailable"; } catch (e) { return false; } }
  // Prominent notice shown ONLY when the app has been hidden from new customers — a deliberate,
  // notable state the developer should see the moment they open the live app.
  function availabilityCardHTML() {
    if (!availUnavailable()) return "";
    return '<div class="app-status-card app-status-card--paused">' +
      '<span class="app-status-card__ico"><iconify-icon icon="fluent:eye-off-20-filled" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
      '<div class="app-status-card__body"><strong class="app-status-card__title">Hidden from new customers</strong>' +
        '<span class="app-status-card__sub"><strong>' + esc(appName()) + '</strong> isn\u2019t discoverable in the Store. Existing customers keep access and can reinstall.</span></div>' +
      '<a class="asc-btn asc-btn--ghost" href="#" data-live-action="availability">Manage</a>' +
    '</div>';
  }
  // Proactive discovery: a small, curated set of "what's worth doing next" for THIS app, derived from
  // its real state — so the overview isn't just a menu of everything, it points you at the high-value
  // moves. Adaptive (health > visibility > growth > monetization), capped at 3, empty when all is well.
  // Each card reuses the hub's routing (data-live-action → window.start<X>) or deep-links to analytics.
  function nextStepsHTML() {
    var recs = [], s = appStatsData() || {};
    if (s.crashRate != null && (+s.crashRate) >= 5) {
      recs.push({ icon: "fluent:pulse-20-regular", accent: "warn", title: "Investigate elevated crashes",
        sub: "Crash rate is " + (+s.crashRate).toFixed(2) + "% — above the 5% healthy bar.",
        href: "../" + PORTAL_FILE + "?anaApp=" + encodeURIComponent(id) + "&anaTab=crashes#analytics" });
    }
    if (availUnavailable()) {
      recs.push({ icon: "fluent:eye-20-regular", accent: "brand", title: "Make your app discoverable",
        sub: "It's currently hidden from new customers in the Store.", action: "availability" });
    }
    if (dashCount("tdp.experiments.") === 0) {
      recs.push({ icon: "fluent:beaker-20-regular", accent: "growth", title: "A/B test your Store listing",
        sub: "Run a product page experiment to see what converts.", action: "experiments" });
    }
    if (dashCount("tdp.addons.") === 0) {
      recs.push({ icon: "fluent:puzzle-piece-20-regular", accent: "mon", title: "Add in-app products",
        sub: "Offer add-ons or subscriptions to your customers.", action: "addons" });
    }
    recs = recs.slice(0, 3);
    if (!recs.length) return "";
    var cards = recs.map(function (r) {
      var attrs = r.href ? 'href="' + r.href + '"' : 'href="#" data-live-action="' + r.action + '"';
      return '<a class="live-rec live-rec--' + r.accent + '" ' + attrs + '>' +
        '<span class="live-rec__ico"><iconify-icon icon="' + r.icon + '" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
        '<span class="live-rec__t"><strong>' + esc(r.title) + '</strong><span>' + esc(r.sub) + '</span></span>' +
        '<iconify-icon class="live-rec__chev" icon="fluent:chevron-right-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></a>';
    }).join("");
    return '<section class="live-recs"><h3 class="live-recs__title">Recommended next steps</h3>' +
      '<div class="live-recs__grid">' + cards + '</div></section>';
  }
  // ---- App dashboard (the published Overview): a STATUS surface, NOT a nav mirror. The rail owns
  //      navigation; here we answer "how is my app doing & what's happening" — health with trends,
  //      recommended next steps, recent activity, ratings, and anything currently active. ----
  function dashHash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function dashDelta(up, good, text) {
    var clean = String(text).replace(/^[+\u2212-]\s*/, "").replace(/\s+this week$/i, "");   // triangle shows direction; drop the sign/period
    return '<span class="live-delta live-delta--' + (good ? "good" : "bad") + '">' + (up ? "\u25B2" : "\u25BC") + " " + esc(clean) + '</span>';
  }
  function dashMetric(icon, label, value, mod, href, trend, spark) {
    var cls = "live-stat" + (mod ? " live-stat--" + mod : "") + (href ? " live-stat--link" : "");
    var go = href ? '<span class="live-stat__go" aria-hidden="true"><iconify-icon icon="fluent:arrow-up-right-16-regular" width="15" height="15"></iconify-icon></span>' : "";
    var inner = go + '<span class="live-stat__label">' + label + '</span>' +
      '<div class="live-stat__row"><strong class="live-stat__value">' + value + '</strong>' + (trend || "") + '</div>' +
      (spark ? '<span class="live-stat__sub">Last 7 days</span>' : "") + (spark || "");
    return href ? '<a class="' + cls + '" href="' + href + '" title="View ' + esc(label) + ' analytics">' + inner + '</a>' : '<div class="' + cls + '">' + inner + '</div>';
  }
  // Health at a glance — the same headline figures as the portal Apps table, now with a deterministic
  // week-over-week trend so the developer sees DIRECTION, not just a number.
  function healthBandHTML() {
    var s = appStatsData() || {};
    var hasI = s.installs != null, hasC = s.crashRate != null, hasR = s.rating != null;
    var warn = hasC && (+s.crashRate) >= 5;
    var ana = function (t) { return "../" + PORTAL_FILE + "?anaApp=" + encodeURIComponent(id) + "&anaTab=" + t + "#analytics"; };
    var hi = dashHash(id + "i"), hc = dashHash(id + "c"), hr = dashHash(id + "r");
    var iUp = (hi % 10) < 7, iMag = (hi % 17) + 4;              // installs mostly up, 4..20%
    var cUp = (hc % 10) < 4, cMag = ((hc % 9) + 1) / 10;        // crash mostly down (good), 0.1..0.9 pts
    var rUp = (hr % 10) < 6, rMag = ((hr % 3) + 1) / 10;        // rating ±0.1..0.3
    var iTrend = hasI ? dashDelta(iUp, iUp, (iUp ? "+" : "\u2212") + iMag + "% this week") : "";
    var cTrend = hasC ? dashDelta(cUp, !cUp, (cUp ? "+" : "\u2212") + cMag.toFixed(1) + " pts") : "";
    var rTrend = hasR ? dashDelta(rUp, rUp, (rUp ? "+" : "\u2212") + rMag.toFixed(1)) : "";
    var iVal = hasI ? statFmt(s.installs) : "0";
    var cVal = hasC ? (+s.crashRate).toFixed(2) + "%" : "\u2014";
    var rVal = hasR ? (+s.rating).toFixed(1) + ' <small>(' + statFmt(s.ratingCount || 0) + ')</small>' : "\u2014";
    return '<div class="live-metrics">' +
      dashMetric("fluent:arrow-download-20-regular", "Installs", iVal, "", ana("acquisition"), iTrend) +
      dashMetric("fluent:pulse-20-regular", "Crash rate", cVal, warn ? "warn" : "ok", ana("crashes"), cTrend) +
      dashMetric("fluent:star-20-regular", "Rating", rVal, "", ana("ratings"), rTrend) +
    '</div>';
  }
  function dashSubmissions() { var a = readJSON("tdp.submissions." + id, null); return Array.isArray(a) ? a : []; }
  function dashRelTime(ms) {
    var d = Date.now() - ms, day = 864e5;
    if (d < 36e5) return Math.max(1, Math.round(d / 6e4)) + " min ago";
    if (d < day) return Math.max(1, Math.round(d / 36e5)) + " h ago";
    if (d < 2 * day) return "Yesterday";
    if (d < 7 * day) return Math.round(d / day) + " days ago";
    if (d < 30 * day) return Math.max(1, Math.round(d / (7 * day))) + " wk ago";
    return new Date(ms).toLocaleDateString();
  }
  // What's happened lately — grounded in real submissions, plus stable milestones derived from the
  // app's own stats. This is genuinely NEW information (the rail can't show it), not a nav copy.
  function activityHTML() {
    var items = [], s = appStatsData() || {}, subs = dashSubmissions();
    if (subs.length) {
      var sub = subs[0];
      var M = { published: ["fluent:checkmark-circle-20-filled", "success", "Version " + sub.v + " is live", "Passed certification and rolled out to the Store."],
                "in-review": ["fluent:clock-20-filled", "info", "Version " + sub.v + " is in review", "We’re certifying your latest submission."],
                rejected: ["fluent:error-circle-20-filled", "danger", "Version " + sub.v + " needs attention", "Certification found issues to fix."] };
      var m = M[sub.status] || M.published;
      items.push({ i: m[0], a: m[1], t: m[2], s: m[3], d: Math.max(0, (Date.now() - sub.date) / 864e5) });
    } else {
      items.push({ i: "fluent:rocket-20-filled", a: "success", t: "Your app is live", s: "Published and available to customers in the Store.", d: (dashHash(id + "live") % 40) + 6 });
    }
    if (s.installs != null) {
      var ms = s.installs >= 1e6 ? "1M" : s.installs >= 1e5 ? "100K" : s.installs >= 1e4 ? "10K" : s.installs >= 1e3 ? "1K" : null;
      if (ms) items.push({ i: "fluent:arrow-download-20-filled", a: "brand", t: "Installs passed " + ms, s: statFmt(s.installs) + " lifetime installs and counting.", d: 2 + dashHash(id + "in") % 4 });
    }
    if (s.rating != null) {
      var nr = (dashHash(id + "nr") % 9) + 2;
      items.push({ i: "fluent:star-20-filled", a: "warn", t: nr + " new ratings this week", s: "Your rating is holding at " + (+s.rating).toFixed(1) + "\u2605.", d: 1 + dashHash(id + "nr2") % 3 });
    }
    if (s.crashRate != null) {
      var w = (+s.crashRate) >= 5;
      items.push({ i: w ? "fluent:warning-20-filled" : "fluent:shield-checkmark-20-filled", a: w ? "danger" : "success", t: w ? "Crash rate needs a look" : "Stability looks healthy", s: (w ? "Crash rate is elevated at " : "Crash rate is steady at ") + (+s.crashRate).toFixed(2) + "%.", d: 3 + dashHash(id + "cr") % 5 });
    }
    items.sort(function (x, y) { return x.d - y.d; });   // most recent first
    var rows = items.slice(0, 5).map(function (it) {
      var time = it.d < 1 ? "Today" : it.d < 2 ? "Yesterday" : Math.round(it.d) + " days ago";
      return '<li class="dash-act"><span class="dash-act__ico dash-act__ico--' + it.a + '"><iconify-icon icon="' + it.i + '" width="18" height="18" aria-hidden="true"></iconify-icon></span>' +
        '<div class="dash-act__body"><span class="dash-act__title">' + esc(it.t) + '</span><span class="dash-act__sub">' + esc(it.s) + '</span></div>' +
        '<span class="dash-act__time">' + esc(time) + '</span></li>';
    }).join("");
    return '<section class="dash-card"><div class="dash-card__head"><h3 class="dash-card__title">Recent activity</h3>' +
      '<a class="dash-card__link" href="#" data-live-action="history">View submissions</a></div>' +
      '<ul class="dash-act-list">' + rows + '</ul></section>';
  }
  function dashStars(r) {
    var out = "", full = Math.round(r);
    for (var i = 1; i <= 5; i++) out += '<iconify-icon icon="' + (i <= full ? "fluent:star-16-filled" : "fluent:star-16-regular") + '" width="14" height="14" aria-hidden="true"></iconify-icon>';
    return '<span class="dash-rev__stars">' + out + '</span>';
  }
  // Ratings & reviews — sentiment at a glance (score + distribution). High-value, and not in the rail.
  function reviewsSummaryHTML() {
    var s = appStatsData() || {};
    if (s.rating == null) return "";
    var r = +s.rating, total = s.ratingCount || 0;
    var dist = r >= 4.5 ? [70, 20, 6, 2, 2] : r >= 4.0 ? [55, 27, 10, 5, 3] : r >= 3.5 ? [45, 25, 15, 8, 7] : r >= 3.0 ? [35, 25, 18, 12, 10] : [22, 20, 20, 18, 20];
    var bars = dist.map(function (p, i) { return '<div class="dash-rev__row"><span class="dash-rev__k">' + (5 - i) + '\u2605</span><span class="dash-rev__bar"><span class="dash-rev__fill" style="width:' + p + '%"></span></span><span class="dash-rev__pct">' + p + '%</span></div>'; }).join("");
    var href = "../" + PORTAL_FILE + "?anaApp=" + encodeURIComponent(id) + "&anaTab=ratings#analytics";
    return '<section class="dash-card dash-rev"><div class="dash-card__head"><h3 class="dash-card__title">Ratings &amp; reviews</h3><a class="dash-card__link" href="' + href + '">See reviews</a></div>' +
      '<div class="dash-rev__top"><div class="dash-rev__score"><strong>' + r.toFixed(1) + '</strong>' + dashStars(r) + '<span class="dash-rev__count">' + statFmt(total) + ' ratings</span></div></div>' +
      '<div class="dash-rev__bars">' + bars + '</div></section>';
  }
  // Only what's actually running right now — shown when there IS live state, omitted otherwise. This is
  // status (not a menu), so it never lists an empty capability.
  function activeNowHTML() {
    var chips = [];
    var e = dashCount("tdp.experiments."); if (e) chips.push(["fluent:beaker-20-regular", e + " experiment" + (e > 1 ? "s" : "") + " running", "experiments"]);
    var f = dashCount("tdp.flights."); if (f) chips.push(["fluent:airplane-take-off-20-regular", f + " flight" + (f > 1 ? "s" : "") + " active", "flights"]);
    var a = dashCount("tdp.addons."); if (a) chips.push(["fluent:puzzle-piece-20-regular", a + " add-on" + (a > 1 ? "s" : "") + " live", "addons"]);
    if (availUnavailable()) chips.push(["fluent:eye-off-20-regular", "Hidden from new customers", "availability"]);
    if (!chips.length) return "";
    var out = chips.map(function (c) { return '<a class="dash-chip" href="#" data-live-action="' + c[2] + '"><iconify-icon icon="' + c[0] + '" width="15" height="15" aria-hidden="true"></iconify-icon>' + esc(c[1]) + '</a>'; }).join("");
    return '<section class="dash-active"><h3 class="dash-active__title">Active now</h3><div class="dash-active__chips">' + out + '</div></section>';
  }
  // ==== Lifecycle-aware Overview =================================================================
  // The published Overview adapts to where the app is in its life: LAUNCH (just live — guide + build
  // momentum), GROWING (early data + growth), ESTABLISHED (health, anomalies, insight, monetization).
  // A demo toggle forces a stage so we can show the triad how the page evolves; "Auto" derives the
  // stage from real signals (install volume) so every module tells ONE coherent story.
  function demoStageGet() { try { return localStorage.getItem("tdp.demoStage") || ""; } catch (e) { return ""; } }
  function demoStageSet(v) { try { v ? localStorage.setItem("tdp.demoStage", v) : localStorage.removeItem("tdp.demoStage"); } catch (e) {} }
  window.__setDemoStage = function (v) { demoStageSet(v); if (window.__renderLiveHub) window.__renderLiveHub(); syncDemoFab(true); };
  // Floating, collapsed-by-default demo control (mirrors the cert "Preview" pill) — kept OUT of the page
  // flow so it never clutters the real UI. Lives at .app level so it survives dashboard re-renders.
  function mountDemoFab() {
    if (document.getElementById("demo-fab")) return;
    var host = document.querySelector(".app") || document.body;
    var fab = document.createElement("div");
    fab.id = "demo-fab"; fab.className = "demo-fab"; fab.hidden = true;
    var seg = function (v, l) { return '<button type="button" data-demo-stage="' + v + '">' + l + '</button>'; };
    fab.innerHTML =
      '<div class="demo-fab__panel" role="group" aria-label="Preview app lifecycle stage">' +
        '<span class="demo-fab__title"><iconify-icon icon="fluent:beaker-16-regular" width="13" height="13" aria-hidden="true"></iconify-icon>Preview lifecycle stage</span>' +
        '<div class="demo-fab__segs">' + seg("launch", "Launch") + seg("growing", "Growing") + seg("established", "Established") + seg("", "Auto") + '</div>' +
        '<span class="demo-fab__note">Demo only — previews how this page evolves as the app matures.</span>' +
      '</div>' +
      '<button type="button" class="demo-fab__toggle" data-demo-fab-toggle aria-expanded="false" aria-label="Preview app lifecycle stage (demo)">' +
        '<iconify-icon icon="fluent:beaker-20-filled" width="16" height="16" aria-hidden="true"></iconify-icon>' +
        '<span class="demo-fab__lbl">Demo</span><span class="demo-fab__cur">Auto</span>' +
        '<iconify-icon class="demo-fab__chev" icon="fluent:chevron-up-16-filled" width="14" height="14" aria-hidden="true"></iconify-icon>' +
      '</button>';
    host.appendChild(fab);
    fab.addEventListener("click", function (e) {
      var tg = e.target.closest("[data-demo-fab-toggle]");
      if (tg) { var open = fab.classList.toggle("is-open"); tg.setAttribute("aria-expanded", String(open)); return; }
      var s = e.target.closest("[data-demo-stage]");
      if (s) window.__setDemoStage(s.getAttribute("data-demo-stage"));
    });
  }
  function syncDemoFab(show) {
    var fab = document.getElementById("demo-fab"); if (!fab) return;
    fab.hidden = !show;
    var cur = demoStageGet() || "";
    var c = fab.querySelector(".demo-fab__cur"); if (c) c.textContent = cur === "launch" ? "Launch" : cur === "growing" ? "Growing" : cur === "established" ? "Established" : "Auto";
    Array.prototype.forEach.call(fab.querySelectorAll("[data-demo-stage]"), function (b) { b.classList.toggle("is-active", (b.getAttribute("data-demo-stage") || "") === cur); });
  }
  function anaTab(t) { return "../" + PORTAL_FILE + "?anaApp=" + encodeURIComponent(id) + "&anaTab=" + t + "#analytics"; }
  function resolveStage() {
    var o = demoStageGet(); if (o) return o;
    var s = appStatsData() || {}, n = s.installs || 0;
    return n < 500 ? "launch" : n < 50000 ? "growing" : "established";
  }
  // Coherent data bundle for the stage. Forced (demo) => a clean synthetic profile; auto => real stats.
  function stageProfile() {
    var stage = resolveStage(), forced = !!demoStageGet();
    if (forced && stage === "launch") return { stage: "launch", installs: 180, installsTrend: null, crashRate: null, crashTrend: null, rating: null, ratingCount: 0, ratingTrend: null, ageDays: 2, version: "1.0.0", versionDaysAgo: 2, anomaly: null, themes: [], addons: 0, exps: 0, revenue: 0 };
    if (forced && stage === "established") return { stage: "established", installs: 842000, installsTrend: { pct: 3, up: true }, crashRate: 4.9, crashTrend: { pts: 1.6, up: true }, rating: 3.9, ratingCount: 12400, ratingTrend: { delta: 0.2, up: false }, ageDays: 760, version: "3.4.1", versionDaysAgo: 9, anomaly: { title: "Crash rate spiked after 3.4.1", text: "Started after your 3.4.1 release 9 days ago — mostly at launch.", tab: "crashes" }, themes: ["startup crashes", "sign-in", "dark mode"], addons: 3, exps: 1, revenue: 18400 };
    if (forced) return { stage: "growing", installs: 8600, installsTrend: { pct: 34, up: true }, crashRate: 1.8, crashTrend: { pts: 0.3, up: false }, rating: 4.3, ratingCount: 210, ratingTrend: { delta: 0.2, up: true }, ageDays: 38, version: "1.2.0", versionDaysAgo: 6, anomaly: null, themes: [], addons: 0, exps: 0, revenue: 0 };
    // auto: real stats + derived (coherent) trends
    var s = appStatsData() || {}, hi = dashHash(id + "i"), hc = dashHash(id + "c"), hr = dashHash(id + "r");
    var P = { stage: stage, installs: s.installs != null ? s.installs : null, crashRate: s.crashRate != null ? +s.crashRate : null, rating: s.rating != null ? +s.rating : null, ratingCount: s.ratingCount || 0, addons: dashCount("tdp.addons."), exps: dashCount("tdp.experiments."), themes: [], anomaly: null, revenue: 0 };
    var subs = dashSubmissions(); if (subs.length) { P.version = subs[0].v; P.versionDaysAgo = Math.max(0, (Date.now() - subs[0].date) / 864e5); }
    if (stage === "launch") { P.installsTrend = P.crashTrend = P.ratingTrend = null; }
    else {
      P.installsTrend = P.installs != null ? { pct: (hi % 17) + 4, up: (hi % 10) < 7 } : null;
      P.crashTrend = P.crashRate != null ? { pts: ((hc % 9) + 1) / 10, up: (hc % 10) < 4 } : null;
      P.ratingTrend = P.rating != null ? { delta: ((hr % 3) + 1) / 10, up: (hr % 10) < 6 } : null;
    }
    if (stage === "established" && P.crashRate != null && P.crashRate >= 5 && P.crashTrend && P.crashTrend.up)
      P.anomaly = { title: "Crash rate is climbing", text: "Climbing since your recent release \u2014 worth a look before it hits your rating.", tab: "crashes" };
    if (stage === "established") P.themes = ["performance", "sign-in"];
    return P;
  }
  function dashStageBar() {
    var cur = demoStageGet() || "auto";
    var seg = function (val, label) { var k = val || "auto"; return '<button type="button" class="dash-seg' + (k === cur ? " is-active" : "") + '" data-demo-stage="' + val + '">' + label + '</button>'; };
    return '<div class="dash-stagebar"><span class="dash-stagebar__tag"><iconify-icon icon="fluent:beaker-20-filled" width="14" height="14" aria-hidden="true"></iconify-icon>Demo</span>' +
      '<span class="dash-stagebar__label">Lifecycle stage</span>' +
      '<div class="dash-seg-group" role="group" aria-label="Preview app lifecycle stage">' + seg("launch", "Launch") + seg("growing", "Growing") + seg("established", "Established") + seg("", "Auto") + '</div></div>';
  }
  function dashCollecting(txt) { return '<fluent-badge size="small" appearance="tint" color="subtle" class="dash-trend dash-trend--muted">' + esc(txt || "Collecting…") + '</fluent-badge>'; }
  // Sparkline — the SAME chart as the analytics summary cards (portal.js spark()) for consistency:
  // a 12%-opacity filled area under a 2px polyline, full-bleeding to the card's bottom edge.
  function dashSpark(values, color) {
    var W = 280, H = 54, mx = -Infinity, mn = Infinity;
    values.forEach(function (v) { if (v > mx) mx = v; if (v < mn) mn = v; });
    var n = values.length, rng = (mx - mn) || 1;
    var pts = values.map(function (v, i) { return (W * i / (n - 1)).toFixed(1) + "," + (H - 5 - (H - 11) * (v - mn) / rng).toFixed(1); }).join(" ");
    return '<svg class="live-stat__spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,' + H + ' ' + pts + ' ' + W + ',' + H + '" fill="' + color + '" opacity=".12"/><polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2"/></svg>';
  }
  // Deterministic ~14-point series trending up/down (seeded per app+metric) to feed the sparkline.
  function dashSeries(seed, up) {
    var n = 14, out = [];
    for (var i = 0; i < n; i++) { var t = i / (n - 1), drift = (up ? t : 1 - t) * 34, noise = ((dashHash(seed + "|" + i) % 1000) / 1000 - 0.5) * 18; out.push(50 + drift + noise); }
    return out;
  }
  function dashHealth(P) {
    // The crash card warns when it's genuinely a problem — over the absolute 5% bar OR the active
    // anomaly — so the metric card agrees with the banner instead of reading "normal".
    var warn = (P.crashRate != null && P.crashRate >= 5) || !!(P.anomaly && P.anomaly.tab === "crashes");
    // Pre-data metrics read forward-looking ("when this shows up"), not a blank "No data yet".
    var soon = function (txt) { return '<span class="live-stat__empty live-stat__empty--soon"><iconify-icon icon="fluent:clock-20-regular" width="14" height="14" aria-hidden="true"></iconify-icon>' + txt + '</span>'; };
    var iVal = P.installs != null ? statFmt(P.installs) : soon("Rolling out");
    var iTr = P.installsTrend ? dashDelta(P.installsTrend.up, P.installsTrend.up, (P.installsTrend.up ? "+" : "−") + P.installsTrend.pct + "% this week") : "";
    var cVal = P.crashRate != null ? P.crashRate.toFixed(2) + "%" : soon("After first runs");
    var cTr = P.crashTrend ? dashDelta(P.crashTrend.up, !P.crashTrend.up, (P.crashTrend.up ? "+" : "−") + P.crashTrend.pts.toFixed(1) + " pts") : "";
    var rVal = P.rating != null ? P.rating.toFixed(1) + ' <small>(' + statFmt(P.ratingCount) + ')</small>' : soon("After first reviews");
    var rTr = P.ratingTrend ? dashDelta(P.ratingTrend.up, P.ratingTrend.up, (P.ratingTrend.up ? "+" : "−") + P.ratingTrend.delta.toFixed(1)) : "";
    return '<div class="live-metrics">' +
      dashMetric("fluent:arrow-download-20-regular", "Installs", iVal, "", anaTab("acquisition"), iTr, P.installsTrend ? dashSpark(dashSeries(id + "sInst", P.installsTrend.up), "#4ad17a") : "") +
      dashMetric("fluent:pulse-20-regular", "Crash rate", cVal, warn ? "warn" : "ok", anaTab("crashes"), cTr, P.crashTrend ? dashSpark(dashSeries(id + "sCrash", P.crashTrend.up), "var(--brand)") : "") +
      dashMetric("fluent:star-20-regular", "Rating", rVal, "", anaTab("ratings"), rTr, P.ratingTrend ? dashSpark(dashSeries(id + "sRate", P.ratingTrend.up), "#f7b955") : "") +
    '</div>';
  }
  function dashRecs(P) {
    var recs = [];
    if (P.stage === "launch") {
      recs.push(["fluent:share-20-regular", "brand", "Share your Store listing", "Drive your first installs from your own channels.", "share", null]);
      recs.push(["fluent:local-language-20-regular", "growth", "Add more languages", "Reach customers in their language.", "names", null]);
      recs.push(["fluent:puzzle-piece-20-regular", "mon", "Add in-app products", "Set up add-ons or subscriptions to earn.", "addons", null]);
    } else if (P.stage === "established") {
      // A mature app leads with health & growth — reviews, experiments, and growing its monetized base.
      // Share is always one click away in the rail, so it isn't repeated as a rec here.
      if (P.ratingTrend && !P.ratingTrend.up) recs.push(["fluent:comment-20-regular", "brand", "Reply to recent reviews", "Responding helps win customers back.", null, anaTab("ratings")]);
      if (P.exps) recs.push(["fluent:beaker-20-regular", "growth", "Review your live experiment", "See which variant is winning.", "experiments", null]);
      else recs.push(["fluent:beaker-20-regular", "growth", "Experiment on your listing", "Test screenshots to lift conversion.", "experiments", null]);
      if (!P.addons) recs.push(["fluent:puzzle-piece-20-regular", "mon", "Add in-app products", "Monetize your install base with add-ons.", "addons", null]);
      else recs.push(["fluent:money-20-regular", "mon", "Grow your add-on revenue", "Review pricing and add new in-app products.", "addons", null]);
    } else {
      if (P.exps) recs.push(["fluent:beaker-20-regular", "growth", "Review your live experiment", "See which variant is winning.", "experiments", null]);
      else recs.push(["fluent:beaker-20-regular", "growth", "A/B test your Store listing", "See which listing converts best.", "experiments", null]);
      recs.push(["fluent:star-20-regular", "brand", "Ask for ratings & reviews", "Share your Store link so happy customers can rate you.", "share", null]);
      if (!P.addons) recs.push(["fluent:puzzle-piece-20-regular", "mon", "Add in-app products", "Offer add-ons or subscriptions.", "addons", null]);
    }
    recs = recs.slice(0, 3);   // 3 across, one row — same layout as growing/established
    if (!recs.length) return "";
    var meta = "";
    var cards = recs.map(function (r) {
      var attrs = r[5] ? 'href="' + r[5] + '"' : 'href="#" data-live-action="' + r[4] + '"';
      return '<a class="live-rec live-rec--' + r[1] + '" ' + attrs + '><span class="live-rec__ico"><iconify-icon icon="' + r[0] + '" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
        '<span class="live-rec__t"><strong>' + esc(r[2]) + '</strong><span>' + esc(r[3]) + '</span></span>' +
        '<iconify-icon class="live-rec__chev" icon="fluent:chevron-right-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></a>';
    }).join("");
    return '<section class="live-recs"><div class="live-recs__head"><h3 class="live-recs__title">Recommended next steps</h3>' + meta + '</div><div class="live-recs__grid" data-count="' + recs.length + '">' + cards + '</div></section>';
  }
  function dashBanner(P) {
    // Needs-attention wins: a real problem to act on now.
    if (P.anomaly) {
      return '<section class="dash-banner dash-banner--warn">' +
        '<span class="dash-banner__ico"><iconify-icon icon="fluent:warning-20-filled" width="22" height="22" aria-hidden="true"></iconify-icon></span>' +
        '<div class="dash-banner__body"><strong class="dash-banner__title">' + esc(P.anomaly.title) + '</strong>' +
        '<span class="dash-banner__sub">' + esc(P.anomaly.text) + '</span></div>' +
        '<fluent-button appearance="primary" data-ana="' + P.anomaly.tab + '">Investigate</fluent-button></section>';
    }
    // Operational status: the app is hidden from new customers.
    if (availUnavailable()) {
      return '<section class="dash-banner dash-banner--warn">' +
        '<span class="dash-banner__ico"><iconify-icon icon="fluent:eye-off-20-filled" width="22" height="22" aria-hidden="true"></iconify-icon></span>' +
        '<div class="dash-banner__body"><strong class="dash-banner__title">Your app is hidden from new customers</strong>' +
        '<span class="dash-banner__sub">Existing customers keep access, but new customers can\u2019t find or install it until you make it available.</span></div>' +
        '<fluent-button appearance="primary" data-live-action="availability">Make available</fluent-button></section>';
    }
    // Elevated crashes without a formal anomaly are still a needs-attention state in any live stage.
    if (P.crashRate != null && P.crashRate >= 5) {
      return '<section class="dash-banner dash-banner--warn">' +
        '<span class="dash-banner__ico"><iconify-icon icon="fluent:warning-20-filled" width="22" height="22" aria-hidden="true"></iconify-icon></span>' +
        '<div class="dash-banner__body"><strong class="dash-banner__title">Crash rate needs a look</strong>' +
        '<span class="dash-banner__sub">You\u2019re above the 5% healthy bar \u2014 worth investigating before it affects your rating.</span></div>' +
        '<fluent-button appearance="primary" data-ana="crashes">Investigate</fluent-button></section>';
    }
    // Growing stage no longer shows an encouragement banner; needs-attention banners above still apply.
    if (P.stage === "growing") return "";
    // Stage-appropriate orientation / encouragement for the remaining stages.
    var ico, tone, title, sub;
    if (P.stage === "launch") {
      ico = "fluent:rocket-20-filled"; tone = "brand"; title = "You\u2019re live in the Microsoft Store";
      sub = "<strong>" + esc(appName()) + "</strong> is published and discoverable \u2014 here\u2019s how to build early momentum.";
    } else {
      ico = "fluent:shield-checkmark-20-filled"; tone = "success"; title = "Your app is in good shape";
      sub = "No fires to fight right now \u2014 a good moment to invest in growth. Start with the steps below.";
    }
    return '<section class="dash-banner dash-banner--' + tone + '">' +
      '<span class="dash-banner__ico"><iconify-icon icon="' + ico + '" width="22" height="22" aria-hidden="true"></iconify-icon></span>' +
      '<div class="dash-banner__body"><strong class="dash-banner__title">' + title + '</strong><span class="dash-banner__sub">' + sub + '</span></div></section>';
  }
  // Reviews come from CUSTOMERS — the developer can't "get" them directly. The one dev-actionable path
  // to early installs (and, in turn, reviews) is sharing the listing. Copies the Store link.
  function dashShare() {
    if (typeof window.startShareListing === "function") { window.startShareListing(); return; }
    var url = "https://apps.microsoft.com/detail/9N2KRDT2DD0S";
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url)["catch"](function () {}); } catch (e) {}
    dashToast("Store link copied to clipboard");
  }
  function dashToast(msg) {
    var t = document.createElement("div"); t.className = "dash-toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function dashAnomaly(P) {
    if (!P.anomaly) return "";
    return '<section class="dash-anomaly">' +
      '<span class="dash-anomaly__ico"><iconify-icon icon="fluent:warning-20-filled" width="22" height="22" aria-hidden="true"></iconify-icon></span>' +
      '<div class="dash-anomaly__body"><div class="dash-anomaly__head"><strong class="dash-anomaly__title">' + esc(P.anomaly.title) + '</strong><fluent-badge size="small" appearance="tint" color="danger">Needs attention</fluent-badge></div>' +
      '<span class="dash-anomaly__sub">' + esc(P.anomaly.text) + '</span></div>' +
      '<fluent-button appearance="primary" data-ana="' + P.anomaly.tab + '">Investigate</fluent-button></section>';
  }
  function dashMon(P) {
    if (!P.addons || !P.revenue) return "";
    return '<section class="dash-card dash-mon"><div class="dash-card__head"><h3 class="dash-card__title">Monetization</h3><a class="dash-card__link" href="#" data-live-action="addons">Manage add-ons</a></div>' +
      '<div class="dash-mon__row">' +
        '<div class="dash-mon__stat"><span class="dash-mon__ico"><iconify-icon icon="fluent:money-20-filled" width="20" height="20" aria-hidden="true"></iconify-icon></span><div class="dash-mon__data"><span class="dash-mon__label">Revenue · last 30 days</span><strong class="dash-mon__value">$' + statFmt(P.revenue) + '</strong></div><fluent-badge size="small" appearance="tint" color="success" class="dash-trend">↑ 8%</fluent-badge></div>' +
        '<div class="dash-mon__stat"><span class="dash-mon__ico"><iconify-icon icon="fluent:puzzle-piece-20-filled" width="20" height="20" aria-hidden="true"></iconify-icon></span><div class="dash-mon__data"><span class="dash-mon__label">Active add-ons</span><strong class="dash-mon__value">' + P.addons + '</strong></div></div>' +
      '</div></section>';
  }
  function dashActivity(P) {
    var items = [];
    items.push({ i: "fluent:checkmark-circle-20-filled", a: "success", t: "Version " + (P.version || "1.0.0") + " is live", s: "Passed certification and rolled out to the Store.", d: P.versionDaysAgo != null ? P.versionDaysAgo : (P.ageDays || 1) });
    if (P.stage === "launch") {
      items.push({ i: "fluent:globe-20-filled", a: "brand", t: "Discoverable in 240 markets", s: "Customers can now find and install your app.", d: P.ageDays });
      items.push({ i: "fluent:arrow-download-20-filled", a: "info", t: "First installs are coming in", s: statFmt(P.installs) + " so far — it takes a few days to ramp.", d: 1 });
    } else {
      var msv = P.installs >= 1e6 ? "1M" : P.installs >= 5e5 ? "500K" : P.installs >= 1e5 ? "100K" : P.installs >= 1e4 ? "10K" : P.installs >= 5e3 ? "5K" : P.installs >= 1e3 ? "1K" : null;
      if (msv) items.push({ i: "fluent:arrow-download-20-filled", a: "brand", t: "Installs passed " + msv, s: statFmt(P.installs) + " lifetime installs and counting.", d: 2 + dashHash(id + "in") % 4 });
      if (P.rating != null) { var nr = (dashHash(id + "nr") % 9) + 2; items.push({ i: "fluent:star-20-filled", a: "warn", t: nr + " new ratings this week", s: "Your rating is at " + P.rating.toFixed(1) + "★.", d: 1 + dashHash(id + "nr2") % 3 }); }
      var worse = P.crashTrend && P.crashTrend.up;
      if (P.crashRate != null && !P.anomaly) {
        var hot = P.crashRate >= 5;   // level AND trend both matter — an elevated rate is never "healthy"
        var ci = hot ? ["fluent:warning-20-filled", "danger", "Crash rate needs attention", (worse ? "Climbed to " : "Still elevated at ") + P.crashRate.toFixed(2) + "%."]
               : worse ? ["fluent:warning-20-filled", "warn", "Crash rate ticked up", "Up to " + P.crashRate.toFixed(2) + "%."]
               : ["fluent:shield-checkmark-20-filled", "success", "Stability looks healthy", "Steady at " + P.crashRate.toFixed(2) + "%."];
        items.push({ i: ci[0], a: ci[1], t: ci[2], s: ci[3], d: 3 + dashHash(id + "cr") % 5 });
      }
      if (P.stage === "established" && P.themes.length) items.push({ i: "fluent:comment-multiple-20-filled", a: "info", t: "Reviews mention " + P.themes[0], s: "A recurring theme in your recent reviews.", d: 2 });
    }
    items.sort(function (x, y) { return x.d - y.d; });
    var rows = items.slice(0, 5).map(function (it) {
      var time = it.d < 1 ? "Today" : it.d < 2 ? "Yesterday" : Math.round(it.d) + " days ago";
      return '<li class="dash-act"><span class="dash-act__ico dash-act__ico--' + it.a + '"><iconify-icon icon="' + it.i + '" width="18" height="18" aria-hidden="true"></iconify-icon></span>' +
        '<div class="dash-act__body"><span class="dash-act__title">' + esc(it.t) + '</span><span class="dash-act__sub">' + esc(it.s) + '</span></div><span class="dash-act__time">' + esc(time) + '</span></li>';
    }).join("");
    return '<section class="dash-card"><div class="dash-card__head"><h3 class="dash-card__title">Recent activity</h3><a class="dash-card__link" href="#" data-live-action="history">See all</a></div><ul class="dash-act-list">' + rows + '</ul></section>';
  }
  function dashReviews(P) {
    if (P.rating == null) {
      return '<section class="dash-card dash-card--empty"><div class="dash-card__head"><h3 class="dash-card__title">Ratings &amp; reviews</h3></div>' +
        '<div class="dash-rev-empty"><span class="dash-rev-empty__ico"><iconify-icon icon="fluent:star-emphasis-20-regular" width="24" height="24" aria-hidden="true"></iconify-icon></span>' +
        '<strong>No ratings yet</strong><span>Ratings show up once customers review your app. Share your Store link to get your first ones.</span></div></section>';
    }
    var r = P.rating, total = P.ratingCount || 0;
    var dist = r >= 4.5 ? [70, 20, 6, 2, 2] : r >= 4.0 ? [55, 27, 10, 5, 3] : r >= 3.5 ? [45, 25, 15, 8, 7] : r >= 3.0 ? [35, 25, 18, 12, 10] : [22, 20, 20, 18, 20];
    var bars = dist.map(function (p, i) { return '<div class="dash-rev__row"><span class="dash-rev__k">' + (5 - i) + '★</span><span class="dash-rev__bar"><span class="dash-rev__fill" style="width:' + p + '%"></span></span><span class="dash-rev__pct">' + p + '%</span></div>'; }).join("");
    var themes = (P.stage === "established" && P.themes.length) ? '<div class="dash-rev__themes"><span class="dash-rev__themes-h">Recent reviews mention</span><div class="dash-rev__themechips">' + P.themes.map(function (t) { return '<fluent-badge size="small" appearance="outline">' + esc(t) + '</fluent-badge>'; }).join("") + '</div></div>' : "";
    return '<section class="dash-card dash-rev"><div class="dash-card__head"><h3 class="dash-card__title">Ratings &amp; reviews</h3><a class="dash-card__link" href="' + anaTab("ratings") + '">See reviews</a></div>' +
      '<div class="dash-rev__top"><div class="dash-rev__score"><strong>' + r.toFixed(1) + '</strong>' + dashStars(r) + '<span class="dash-rev__count">' + statFmt(total) + ' ratings</span></div></div>' +
      ((P.stage === "established" && P.anomaly && P.ratingTrend && !P.ratingTrend.up)
        ? '<div class="dash-rev__insight"><iconify-icon icon="fluent:lightbulb-20-filled" width="16" height="16" aria-hidden="true"></iconify-icon><span>Your rating is slipping as reviews flag <b>' + esc(P.themes[0] || "recent issues") + '</b> \u2014 likely tied to the crash spike above. Fixing it should help it recover.</span></div>'
        : "") +
      '<div class="dash-rev__bars">' + bars + '</div>' + themes + '</section>';
  }
  function dashActive(P) { return ""; }   // removed: current experiments/add-ons/visibility now surface in the banner + owning cards
  // Compose the Overview for the resolved stage. Nav stays in the rail; this is all STATE + guidance.
  function dashboardHTML() {
    var P = stageProfile();
    // Launch: no metrics band and no rating yet — skip the tiles + the Ratings & reviews card (both would
    // be empty placeholders) and let Recent activity span full width. "First installs" still shows installs.
    if (P.stage === "launch") return dashBanner(P) +
      dashRecs(P) + '<div class="dash-grid dash-grid--single">' + dashActivity(P) + '</div>';
    var grid = '<div class="dash-grid">' + dashActivity(P) + dashReviews(P) + '</div>';
    return dashBanner(P) + dashHealth(P) + dashRecs(P) + grid + dashMon(P);
  }
  function passHTML() { return dashboardHTML(); }
  // Re-render the live hub in place (after the availability toggle changes) without a full reload.
  window.__renderLiveHub = function () { var res = $id("cert-result"), done = $id("state-done"); if (res && done && done.__result === "passed") { res.innerHTML = passHTML(); syncHeadUpdatePrimary(); } };

  // ---- Certification result view state machine ----
  var certTimer = null;
  var nextOutcome = "passed";   // default result after a submit; the preview switcher (or an edit) can force the other outcome
  // Whether THIS submission is an update — captured once when the submission view opens so the preview
  // switcher keeps one consistent scenario; a preview "Passed" (which marks the app live via
  // markEverLive) must not flip the other previews into update mode.
  var submissionIsUpdate = false;
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
  // App-header card's contextual action: once published the PRIMARY action is Update; View submissions is
  // secondary and "View in Store" rides on the status pill (#app-storelink). Withdraw while in review; report/fix when failed.
  function setHeadActions(view) {
    var w = $id("head-withdraw-btn"), v = $id("app-storelink"), r = $id("head-report-btn"), e = $id("head-editfix-btn"), an = $id("head-analytics-btn"), u = $id("head-update-btn"), s = $id("head-share-btn");
    if (w) w.hidden = (view !== "progress");
    if (v) v.hidden = (view !== "passed");
    if (r) r.hidden = (view !== "failed");
    if (e) e.hidden = (view !== "failed");
    if (an) an.hidden = (view !== "passed");
    if (u) u.hidden = (view !== "passed");   // Update is the primary action for a live app
    if (s) s.hidden = (view !== "passed");   // Share the Store listing (moved from the sidebar)
    syncHeadUpdatePrimary();
  }
  // When the dashboard shows a needs-attention banner (anomaly), its "Investigate" is the single
  // primary action — demote the header Update to secondary so two primaries don't compete.
  function syncHeadUpdatePrimary() {
    var u = $id("head-update-btn"); if (!u || u.hidden) return;
    u.setAttribute("appearance", document.querySelector("#cert-result .dash-banner [data-ana]") ? "secondary" : "primary");
  }
  function setMsStatus(status) {
    try { var ms = readJSON(MS_KEY, []); var i = (Array.isArray(ms) ? ms : []).map(function (a) { return a.id; }).indexOf(id); if (i >= 0) { ms[i].status = status; localStorage.setItem(MS_KEY, JSON.stringify(ms)); } } catch (e) {}
  }
  function setPortalStore(store, storeStatus) {
    var s = readJSON(TDP_KEY, null);
    if (s && Array.isArray(s.apps)) { var ta = s.apps.filter(function (a) { return a.id === id; })[0]; if (ta) { ta.store = store; ta.storeStatus = storeStatus; try { localStorage.setItem(TDP_KEY, JSON.stringify(s)); } catch (e) {} } }
  }

  // "Has this app ever gone live?" — set the first time certification passes. Distinguishes a FIRST
  // submission (full certification timeline, no hub yet) from an UPDATE to a live app (keep the hub,
  // show a compact status card above it).
  function everLive() { try { return localStorage.getItem("tdp.everLive." + id) === "1"; } catch (e) { return false; } }
  function markEverLive() { try { localStorage.setItem("tdp.everLive." + id, "1"); } catch (e) {} }
  // Whether THIS submission was made via the update flow — persisted per-app at submit (msstore.apps).
  // Used instead of everLive() so a plain published app (never updated) doesn't read as an update on refresh.
  function submittedAsUpdate() { var ms = readJSON(MS_KEY, []); var a = (Array.isArray(ms) ? ms : []).filter(function (x) { return x.id === id; })[0]; return !!(a && a.submissionIsUpdate); }
  // Adapt the shared in-progress timeline card's copy to the scenario (new submission vs update).
  function setProgressScenario(prog, isUpdate) {
    var t = prog.querySelector(".cert-card__title");
    var s = prog.querySelector(".cert-card__sub");
    if (t) t.textContent = isUpdate ? "Update in review" : "Certification in progress";
    try { if (window.__setCertProgressDensity) window.__setCertProgressDensity(isUpdate); } catch (e) {}
    if (s) s.textContent = isUpdate
      ? "Your live version stays published while we review the update \u2014 we\u2019ll email you when it\u2019s done."
      : "We\u2019re reviewing your app. You don\u2019t need to do anything \u2014 we\u2019ll email you when it\u2019s done.";
    try {
      if (window.__certStagesHTML) {
        var w = certWin32();
        var st = prog.querySelector(".cert-stages"); if (st) st.innerHTML = window.__certStagesHTML("progress", w);
        var sp = prog.querySelector(".cert-strip--summary"); if (sp) sp.innerHTML = window.__certStripHTML("progress", w);
      }
    } catch (e) {}
  }
  function showProgress() {
    var done = $id("state-done"); if (done) done.__result = "progress";
    var prog = $id("cert-progress"), res = $id("cert-result"), act = $id("cert-actions");
    var isUpdate = submissionIsUpdate;   // locked when the submission view opened; preview clicks don't flip it
    if (prog) { prog.hidden = false; setProgressScenario(prog, isUpdate); }
    if (res) {
      if (isUpdate) { res.hidden = false; res.innerHTML = dashboardHTML(); }   // update in review: the cert card sits above; the full app dashboard stays below
      else if (window.__certLivePreviewHTML) { res.hidden = false; res.innerHTML = window.__certLivePreviewHTML({ collapsed: true }); }   // new app: preview what unlocks once live (collapsed by default)
      else { res.hidden = true; res.innerHTML = ""; }
    }
    if (act) act.hidden = isUpdate;
    var bar = $id("submit-bar"); if (bar) bar.hidden = true;
    setPill("In review", "in-review");
    setNotify(!isUpdate);   // first submission keeps the notify banner; the update card already says "we'll email you"
    setHeadActions("progress");
    setSwitch("progress");
    try { renderAppNav(); } catch (e) {}
  }
  function showPassed() {
    var done = $id("state-done"); if (done) done.__result = "passed";
    markEverLive();
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
    try { renderAppNav(); } catch (e) {}
  }
  function showFailed() {
    var done = $id("state-done"); if (done) done.__result = "failed";
    var prog = $id("cert-progress"), res = $id("cert-result"), act = $id("cert-actions");
    var isUpdate = submissionIsUpdate;   // locked when the submission view opened; preview clicks don't flip it
    if (prog) prog.hidden = true;
    if (res) { res.hidden = false; res.innerHTML = isUpdate ? (failHTML(true) + dashboardHTML()) : (failHTML(false) + (window.__certLivePreviewHTML ? window.__certLivePreviewHTML({ collapsed: true }) : "")); }
    if (act) act.hidden = true;
    var bar = $id("submit-bar"); if (bar) bar.hidden = true;
    if (isUpdate) {
      setPill("Published", "published"); setMsStatus("published"); setPortalStore(true, "published");
      setNotify(false); setHeadActions("passed");   // still offers "View in Store" beside the pill — the app is live
    } else {
      setPill("Action needed", "rejected"); setMsStatus("rejected"); setPortalStore(false, "rejected");
      setNotify(true); setHeadActions("failed");
    }
    setSwitch("failed");
    try { renderAppNav(); } catch (e) {}
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
        var stageBtn = e.target.closest("[data-demo-stage]");
        if (stageBtn) { e.preventDefault(); window.__setDemoStage(stageBtn.getAttribute("data-demo-stage")); return; }
        var upd = e.target.closest('[data-live-action="update"]');
        if (upd) { e.preventDefault(); if (typeof window.startAppUpdate === "function") window.startAppUpdate(); return; }
        var experiments = e.target.closest('[data-live-action="experiments"]');
        if (experiments) { e.preventDefault(); if (typeof window.startExperiments === "function") window.startExperiments(); return; }
        var availability = e.target.closest('[data-live-action="availability"]');
        if (availability) { e.preventDefault(); if (typeof window.startAvailability === "function") window.startAvailability(); return; }
        var addons = e.target.closest('[data-live-action="addons"]');
        if (addons) { e.preventDefault(); if (typeof window.startAddons === "function") window.startAddons(); return; }
        var flights = e.target.closest('[data-live-action="flights"]');
        if (flights) { e.preventDefault(); if (typeof window.startFlights === "function") window.startFlights(); return; }
        var names = e.target.closest('[data-live-action="names"]');
        if (names) { e.preventDefault(); if (typeof window.startNames === "function") window.startNames(); return; }
        var promo = e.target.closest('[data-live-action="promo"]');
        if (promo) { e.preventDefault(); if (typeof window.startPromo === "function") window.startPromo(); return; }
        var identity = e.target.closest('[data-live-action="identity"]');
        if (identity) { e.preventDefault(); if (typeof window.startIdentity === "function") window.startIdentity(); return; }
        var history = e.target.closest('[data-live-action="history"]');
        if (history) { e.preventDefault(); if (typeof window.startHistory === "function") window.startHistory(); return; }
        var share = e.target.closest('[data-live-action="share"]');
        if (share) { e.preventDefault(); dashShare(); return; }
        var anaBtn = e.target.closest("[data-ana]");
        if (anaBtn) { e.preventDefault(); location.href = anaTab(anaBtn.getAttribute("data-ana")); return; }
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
      submissionIsUpdate = (!!window.__inUpdateFlow) || submittedAsUpdate();   // update flow (authoritative) or a submission persisted as an update — NOT just "app was ever live"
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
    var name = acct.name || "Your organization", initials = acct.initials || "—", email = acct.email || "";
    if (av) {
      if (av.tagName && av.tagName.toLowerCase() === "fluent-avatar") { av.setAttribute("name", name); av.setAttribute("initials", initials); }
      else av.textContent = initials;
    }
    if (nm) nm.textContent = name;
    // Profile flyout fields (same header as the developer portal).
    var pfa = document.getElementById("pfAvatar"); if (pfa) { pfa.setAttribute("name", name); pfa.setAttribute("initials", initials); }
    var pfn = document.getElementById("pfName"); if (pfn) pfn.textContent = name;
    var pfe = document.getElementById("pfEmail"); if (pfe) pfe.textContent = email;
    var pfae = document.getElementById("pfAcctEmail"); if (pfae) pfae.textContent = email;
    if (PORTAL_FILE === "store-portal.html") {            // opened from the Store portal
      // Header brand stays unified as "Windows Developer Center" (set by wdp-header.js) — one portal.
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
      submissionIsUpdate = (!!window.__inUpdateFlow) || submittedAsUpdate();   // lock the scenario before rendering a restored result
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
