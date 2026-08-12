/* Windows Developer Center — shared left-rail navigation (single source of truth).
   Fills every <nav class="snav" data-wdp-nav> with the SAME items in the SAME order, so the
   portal and the app hub stay in lock-step. Change NAV here once and it updates everywhere.

   Config via data-* on the <nav>:
     • data-wdp-base   — href prefix. "" on the portal (SPA hash: "#apps"); "../developer-portal.html"
                          in the app hub so items link back to the portal.
     • data-wdp-active — key to mark is-active initially (each page's own JS keeps it in sync after).
     • data-wdp-mode   — "spa"  (portal: emits data-nav so portal.js routes it, + #navPromo), or
                          "app"  (hub: plain links, and "Apps" becomes the expandable #nav-apps-group
                                  whose nested #app-nav is filled by tdp-bridge renderAppNav()). */
(function () {
  "use strict";

  var NAV = [
    { key: "overview",        label: "Overview",        icon: "fluent:home-20-regular" },
    { key: "apps",            label: "Apps",            icon: "fluent:apps-20-regular" },
    { key: "analytics",       label: "Analytics",       icon: "fluent:data-histogram-20-regular" },
    { key: "customer-groups", label: "Customer groups", icon: "fluent:people-team-20-regular" },
    { key: "promo-codes",     label: "Promo codes",     icon: "fluent:ticket-diagonal-20-regular" },
    { key: "certificates",    label: "Certificates",    icon: "fluent:certificate-20-regular" }
  ];

  function ico(n) { return '<iconify-icon icon="' + n.icon + '" width="20" height="20" aria-hidden="true"></iconify-icon>'; }

  function fill(nav) {
    if (nav.getAttribute("data-wdp-filled")) return;
    var base = nav.getAttribute("data-wdp-base") || "";
    var active = nav.getAttribute("data-wdp-active") || "";
    var spa = (nav.getAttribute("data-wdp-mode") || "spa") === "spa";

    nav.innerHTML = NAV.map(function (n) {
      var href = base + "#" + n.key, on = n.key === active;
      // App hub: "Apps" is the expandable disclosure for THIS app's capabilities.
      if (!spa && n.key === "apps") {
        return '<div class="snav-parent" id="nav-apps-group">' +
            '<div class="snav-parent__row">' +
              '<a href="' + href + '" data-tip="' + n.label + '"' + (on ? ' class="is-active"' : '') + '>' + ico(n) + n.label + '</a>' +
              '<button type="button" class="snav-parent__toggle" id="nav-apps-toggle" aria-expanded="true" aria-label="Collapse app sections" hidden>' +
                '<iconify-icon icon="fluent:chevron-down-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon>' +
              '</button>' +
            '</div>' +
            '<div class="appnav" id="app-nav" hidden></div>' +
          '</div>';
      }
      var attrs = ' data-tip="' + n.label + '"' +
        (spa ? " data-nav" : "") +
        (spa && n.key === "promo-codes" ? ' id="navPromo"' : "") +
        (on ? ' class="is-active"' : "");
      return '<a href="' + href + '"' + attrs + ">" + ico(n) + n.label + "</a>";
    }).join("");

    nav.setAttribute("data-wdp-filled", "1");
  }

  function fillAll() {
    var navs = document.querySelectorAll("nav.snav[data-wdp-nav]");
    for (var i = 0; i < navs.length; i++) fill(navs[i]);
  }

  // Run immediately for the nav already parsed (this script sits right after the sidebar), then
  // again on DOMContentLoaded as a safety net.
  fillAll();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillAll);
})();
