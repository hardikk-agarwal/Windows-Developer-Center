/* Unified developer portal — data-driven, persisted to localStorage.
   The ONLY mock element is the demo MSA sign-in account.

   ONE engine, TWO doors: portal.html runs this in WDP mode; store-portal.html sets
   window.PORTAL_MODE = "store" before loading this SAME file. Everything below is
   personalised off STORE (the path the developer chose) plus each app's own store
   status — there is no second copy of this code.

   WDP flow: "Add certificate" submits one or more signed binaries. The real
   Authenticode signer (via the local backend) is attached as a certificate. The
   submitted binary only PROVES the certificate — it is not itself listed as an
   app. Apps are then discovered from this PC: the real installed apps signed by
   that certificate are auto-populated under it (one cert → all its apps).
   Store flow: developers create apps directly and publish them to the Store;
   the same Certificates tab lets them bring non-Store apps in via a certificate. */
(function () {
  "use strict";

  // STORE = the developer is on the Microsoft Store path (store-portal.html).
  var STORE = (typeof window !== "undefined" && window.PORTAL_MODE === "store");
  var KEY = STORE ? "tdp.portal.store.v1" : "tdp.portal.v5";
  var DEMO_MSA = { name: "Alex Taylor", email: "alex.taylor@outlook.com", initials: "AT" };

  var state = load();
  var pending = []; // files staged in the modal
  var scanning = false; // true while discovering installed apps by certificate

  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.certs && s.apps) return s; } catch (e) {}
    return { signedIn: false, account: null, verified: false, certs: [], apps: [] };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function uid() { return "id-" + Math.abs(hashStr(String(Date.now()) + Math.random())).toString(36); }
  function hashStr(s) { var h = 0, i; for (i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }

  async function sha256(file) {
    var buf = await file.arrayBuffer();
    var d = await crypto.subtle.digest("SHA-256", buf);
    return Array.prototype.map.call(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  function fmtThumb(hex) { var u = hex.toUpperCase(); return u.slice(0, 16).match(/.{1,4}/g).join(" ") + " … " + u.slice(-4); }
  function fmtSize(n) { if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB"; if (n >= 1024) return (n / 1024).toFixed(0) + " KB"; return n + " B"; }
  function today() { return new Date().toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }); }
  function initials(name) {
    return name.replace(/\.[^.]+$/, "").split(/[\s_\-.]+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w[0].toUpperCase(); }).join("") || "AP";
  }
  var PALETTE = ["#0F6CBD", "#8661C5", "#107C41", "#C239B3", "#D83B01", "#0B6A0B"];
  function colorFor(seed) { return PALETTE[Math.abs(hashStr(seed)) % PALETTE.length]; }
  // A data-URL copy of the portal's app tile (gradient + initials) so the publishing header + live
  // listing can show the SAME logo as the Apps table until a real package logo replaces it.
  function tileDataUrl(name) {
    var c = colorFor(name), t = initials(name);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="' + c + '"/><stop offset="1" stop-color="#0b2a4a"/></linearGradient></defs>'
      + '<rect width="96" height="96" fill="url(#g)"/>'
      + '<text x="48" y="62" font-family="Segoe UI, system-ui, sans-serif" font-size="40" font-weight="600" fill="#ffffff" text-anchor="middle">' + t + '</text>'
      + '</svg>';
    // base64 (not percent-encoded) so it renders reliably as a CSS background-image, not just in <canvas>.
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }
  function cnOf(subject) { if (!subject) return null; var m = /CN=([^,]+)/i.exec(subject); return m ? m[1].trim() : subject; }
  function certById(id) { return state.certs.filter(function (c) { return c.id === id; })[0] || null; }
  function trustWord(s) { return s === "Valid" ? "verified" : s === "NotSigned" ? "unsigned" : "self-signed (not yet verified)"; }
  function trustPill(t) {
    if (t === "Valid") return '<span class="pill pill--ok pill--sm">Valid</span>';
    if (t === "Offline") return '<span class="pill pill--ghost pill--sm">Hash only</span>';
    if (t === "NotSigned") return '<span class="pill pill--warn pill--sm">Unsigned</span>';
    return '<span class="pill pill--warn pill--sm">Unknown</span>';
  }
  // A certificate whose issuer equals its subject is self-signed → not acceptable for TDP.
  function isSelfSigned(info) {
    if (!info || !info.signerThumbprint) return false;
    var s = (info.signerSubject || "").trim().toLowerCase();
    var iss = (info.issuer || "").trim().toLowerCase();
    return !!s && s === iss;
  }
  var SHIELD = "M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3Zm-1.2 13.4L7 11.6 8.4 10l2.4 2.4L15.6 7 17 8.4l-6.2 7Z";
  var FILEICO = "M6 2h8l4 4v16H6V2Zm8 1.5V7h3.5L14 3.5Z";
  function srcSummary(a) {
    var s = a.sources || [];
    if (!s.length) return "None declared";
    var al = s.filter(function (x) { return x.status === "allow"; }).length;
    var bl = s.filter(function (x) { return x.status === "block"; }).length;
    return al + " allowed · " + bl + " blocked";
  }
  function distributingCount() {
    return state.apps.filter(function (a) { return (a.sources || []).some(function (s) { return s.status === "allow"; }); }).length;
  }
  // Chain-trust: do we have at least one certificate Windows actually trusts?
  function hasValidCert() { return state.certs.some(function (c) { return c.trust === "Valid"; }); }

  /* Ask the local backend to read the real Authenticode signature.
     Falls back to a client-side SHA-256 fingerprint when the API is unreachable. */
  async function inspectFile(file) {
    try {
      var res = await fetch("/api/verify-signature?name=" + encodeURIComponent(file.name), { method: "POST", body: file });
      if (!res.ok) throw new Error("api");
      var j = await res.json();
      if (j && j.error) throw new Error(j.error);
      j.offline = false; return j;
    } catch (e) { return { offline: true, status: "Offline", fileSha256: await sha256(file) }; }
  }

  /* ---------------- Toast ---------------- */
  var toastEl = $("toast"), toastTimer;
  function toast(msg, info) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "toast is-show" + (info ? " toast--info" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = "toast" + (info ? " toast--info" : ""); }, 3600);
  }

  /* ---------------- Renderers ---------------- */
  function renderAll() {
    renderAccount(); renderStatus(); renderCerts(); renderApps(); renderAnalytics(); renderSummary(); updateStoreNav();
  }
  // Store: an app is "live" once it's published to the Store.
  function hasLiveStoreApp() { return state.apps.some(function (a) { return a.store || a.storeStatus === "published"; }); }
  // Promo codes is hidden from the left sidebar.
  function updateStoreNav() {
    if (!STORE) return;
    var promo = $("navPromo"); if (promo) promo.hidden = true;   // Promo codes hidden from the sidebar
  }

  function renderAccount() {
    var a = state.account || { name: "Your organization", initials: "—" };
    $("avatar").textContent = a.initials;
    $("accountName").textContent = a.name;
    $("accountStatus").innerHTML = STORE
      ? '<span class="verified-dot"></span>Store developer'
      : !state.verified
        ? '<span class="verified-dot verified-dot--off"></span>No certificate'
        : (hasValidCert()
            ? '<span class="verified-dot"></span>Program member'
            : '<span class="verified-dot verified-dot--warn"></span>Self-signed certificate');
  }

  function renderStatus() {
    var el = $("statusCard");
    if (STORE) { renderStoreStatus(el); return; }
    var allowed = distributingCount();
    var inStore = state.apps.filter(function (x) { return x.store; }).length;
    if (!state.verified) {
      el.innerHTML =
        '<div class="status-card status-card--off status-card--solo">' +
          '<img class="status-card__illo" data-theme-image="trust" src="assets/trust.png" alt="" />' +
          '<div class="status-card__body">' +
            '<span class="pill pill--warn">Certificate needed</span>' +
            '<h2>Add a certificate to unlock your benefits</h2>' +
            '<p class="muted">Add a code signing certificate to unlock frictionless installs and crash analytics for the apps you sign.</p>' +
          '</div>' +
        '</div>';
      return;
    }
    var valid = hasValidCert();
    var pill = valid
      ? '<span class="pill pill--ok"><span class="verified-dot"></span>Windows Developer Program</span>'
      : '<span class="pill pill--warn">Self-signed certificate</span>';
    var head = valid ? esc(state.account.name) + " is all set on Windows"
                     : esc(state.account.name) + "’s certificate needs an upgrade";
    var body = valid
      ? "Your code signing certificate is active. Apps you sign install without SmartScreen interruptions, with crash analytics and a reputation that follows every release."
      : "Your certificate is self-signed, so Windows can’t validate its chain — installs may still show SmartScreen. Use a CA-issued code signing certificate for frictionless installs.";
    el.innerHTML =
      '<div class="status-card status-card--hero' + (valid ? '' : ' status-card--off') + '">' +
        '<div class="status-card__top">' +
          '<img class="status-card__illo" data-theme-image="' + (valid ? 'shield-person' : 'trust') + '" src="assets/' + (valid ? 'shield-person' : 'trust') + '.png" alt="" />' +
          '<div class="status-card__body">' +
            pill +
            '<h2>' + head + '</h2>' +
            '<p class="muted">' + body + '</p>' +
          '</div>' +
          '<div class="status-card__action">' +
            '<fluent-button appearance="outline" data-openmodal>Add certificate</fluent-button>' +
          '</div>' +
        '</div>' +
        '<div class="status-card__metrics">' +
          metric(state.certs.length, "Certificates") + metric(state.apps.length, "Apps") +
          metric(allowed, "Distributing") + metric(inStore, "In Store") +
        '</div>' +
      '</div>';
  }
  function metric(n, label) { return '<div class="metric"><strong>' + n + '</strong><span>' + label + '</span></div>'; }

  // Store variant overview: no verification/certificates — a publish-focused welcome.
  function renderStoreStatus(el) {
    var inStore = state.apps.filter(function (x) { return x.store; }).length;
    var inReview = state.apps.filter(function (x) { return x.storeStatus === "in-review"; }).length;
    var inDraft = state.apps.filter(function (x) { return !x.store && x.storeStatus !== "in-review"; }).length;
    // Metrics only make sense once there's an app — skip the 0/0/0 strip when empty.
    var metricsStrip = state.apps.length
      ? '<div class="status-card__metrics">' +
          metric(state.apps.length, "Apps") + metric(inStore, "In Store") + metric(inReview, "In review") + metric(inDraft, "In draft") +
        '</div>'
      : '';
    el.innerHTML =
      '<div class="status-card status-card--hero">' +
        '<div class="status-card__top">' +
          '<img class="status-card__illo" data-theme-image="rocket" src="assets/rocket.png" alt="" />' +
          '<div class="status-card__body">' +
            '<span class="pill pill--ok"><span class="verified-dot"></span>Microsoft Store developer</span>' +
            '<h2>Publish your apps to the Microsoft Store</h2>' +
            '<p class="muted">Reach more than a billion Windows devices. Track crashes, acquisition, usage, ratings &amp; reviews, and performance — all in one place.</p>' +
          '</div>' +
          '<div class="status-card__action">' +
            '<fluent-button appearance="primary" size="large" data-newapp>' +
              '<iconify-icon slot="start" icon="fluent:add-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon>Add a new app</fluent-button>' +
          '</div>' +
        '</div>' +
        metricsStrip +
      '</div>';
  }

  // One numbered onboarding step for the Store Overview zero state.
  function gstep(n, title, sub, cta) {
    return '<div class="gstep"><span class="gstep__n">' + n + '</span>' +
      '<div class="gstep__t"><strong>' + title + '</strong><span class="muted">' + sub + '</span>' +
      (cta || '') + '</div></div>';
  }

  // Store-only "What can you publish?" on-ramps — rendered inside Get started (zero state) so new
  // developers see what to bring before the steps. Styles: store-portal.css (.pkgdisc / .pkgrow).
  function storeOnrampsHTML() {
    return '<details class="pkgdisc"><summary>' +
      '<span class="pkgdisc__ico"><iconify-icon icon="fluent:box-multiple-20-regular" width="19" height="19" aria-hidden="true"></iconify-icon></span>' +
      '<span class="pkgdisc__label">What can you publish? <span>Find the right fit for what you\u2019re building or already have.</span></span>' +
      '<iconify-icon class="pkgdisc__chev" icon="fluent:chevron-down-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon>' +
      '</summary><div class="pkgdisc__body">' +
        '<div class="pkgrow"><span class="pkgrow__ico"><iconify-icon icon="fluent:cube-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></span>' +
          '<div class="pkgrow__t"><span class="pkgrow__name">Packaged app · MSIX <span class="pkgrow__rec">Recommended</span></span>' +
          '<p class="pkgrow__desc"><b>Building a new app?</b> Package it as MSIX (or APPX/UWP) for the cleanest install and automatic updates.</p></div></div>' +
        '<div class="pkgrow"><span class="pkgrow__ico"><iconify-icon icon="fluent:desktop-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></span>' +
          '<div class="pkgrow__t"><span class="pkgrow__name">Desktop app · Win32</span>' +
          '<p class="pkgrow__desc"><b>Already have an .exe or .msi installer?</b> Publish it as-is, or convert to MSIX for automatic updates.</p></div></div>' +
        '<div class="pkgrow"><span class="pkgrow__ico"><iconify-icon icon="fluent:globe-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></span>' +
          '<div class="pkgrow__t"><span class="pkgrow__name">Web app · PWA</span>' +
          '<p class="pkgrow__desc"><b>Have a website?</b> Turn it into an installable app — nothing to rebuild.</p></div></div>' +
        '<div class="pkgrow"><span class="pkgrow__ico"><iconify-icon icon="fluent:xbox-controller-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></span>' +
          '<div class="pkgrow__t"><span class="pkgrow__name">Game · GDK</span>' +
          '<p class="pkgrow__desc"><b>Building a game?</b> Use the Microsoft Game Development Kit to reach players on Windows and Xbox.</p></div></div>' +
        '<a class="pkgdisc__more" href="https://learn.microsoft.com/windows/apps/publish/" target="_blank" rel="noopener noreferrer">Learn more about publishing to the Store' +
          '<iconify-icon icon="fluent:open-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon></a>' +
      '</div></details>';
  }

  function renderSummary() {
    var el = $("overviewSummary");
    if (!el) return;
    if (STORE) {
      if (!state.apps.length) {                          // fresh portal: guide to the first app, not links to empty views
        el.innerHTML =
          '<div class="block__head block__head--sub"><div><h2>Get started</h2></div></div>' +
          storeOnrampsHTML() +
          '<div class="gsteps">' +
            gstep(1, "Reserve your app name", "Pick a name and default language — it takes a minute.") +
            gstep(2, "Add packages &amp; listing", "Upload your build and write your Store listing with screenshots.") +
            gstep(3, "Submit &amp; go live", "Pass certification and reach customers across Windows.") +
          '</div>';
        return;
      }
      var sn = state.apps.length, sInStore = state.apps.filter(function (a) { return a.store; }).length;
      el.innerHTML =
        '<div class="block__head block__head--sub"><div><h2>Quick links</h2></div></div>' +
        '<div class="ov-grid">' +
          '<a class="ov-card" href="#apps" data-jump="apps"><strong>Apps</strong><span class="muted">' + sn + ' app' + (sn === 1 ? "" : "s") + ' · ' + sInStore + ' in the Store</span><span class="ov-card__cta">View →</span></a>' +
          '<a class="ov-card" href="#analytics" data-jump="analytics"><strong>Analytics</strong><span class="muted">Crashes, installs, usage &amp; ratings</span><span class="ov-card__cta">Open →</span></a>' +
        '</div>';
      return;
    }
    if (!state.verified) {
      el.innerHTML =
        '<div class="verify-card">' +
          '<h2>Verify your certificate</h2>' +
          '<div id="verifyInline"></div>' +
        '</div>';
      var root = $("verifyInline"); root.innerHTML = flowHTML(true); wireFlow(root);
      return;
    }
    var allowed = distributingCount();
    function card(view, title, sub, cta) {
      return '<a class="ov-card" href="#' + view + '" data-jump="' + view + '">' +
        '<strong>' + title + '</strong><span class="muted">' + sub + '</span>' +
        '<span class="ov-card__cta">' + cta + ' →</span></a>';
    }
    el.innerHTML =
      '<div class="block__head block__head--sub"><div><h2>Quick links</h2></div></div>' +
      '<div class="ov-grid">' +
        card("certificates", "Certificates", state.certs.length + " attached", "Manage") +
        card("apps", "Apps", state.apps.length + " registered · " + allowed + " distributing", "View") +
        card("analytics", "Analytics", "Crash data now · unlock more on Store", "Open") +
      '</div>';
  }

  /* The verification flow, rendered either inline (first-time onboarding) or in
     the modal (adding more certs later). One implementation, two containers. */
  function flowHTML(inline) {
    var DL = '<iconify-icon slot="start" icon="fluent:arrow-download-20-regular" width="15" height="15" aria-hidden="true"></iconify-icon>';
    var UP = '<iconify-icon icon="fluent:arrow-upload-24-regular" width="26" height="26" aria-hidden="true"></iconify-icon>';
    var dz = '<div class="dropzone js-dropzone" tabindex="0" role="button" aria-label="Upload signed binaries">' +
        '<input type="file" class="js-fileinput" multiple hidden />' +
        '<div class="dropzone__prompt">' + UP +
          '<span><strong>Drop signed binaries</strong> or click to browse</span>' +
          '<span class="dropzone__hint">.exe · .dll · .msix · .appx · .bin · select multiple</span></div>' +
        '<div class="dropzone__bar js-bar" hidden></div></div>';
    var list = '<ul class="filelist js-filelist"></ul>';

    var err = '<div class="msgbar msgbar--error js-error" role="alert" hidden></div>';

    if (inline) {
      return '<div class="hsteps">' +
        '<div class="hstep">' +
          '<div class="hstep__num">1</div>' +
          '<h3>Download the binary</h3>' +
          '<p class="muted">A unique binary tied to your account — download this exact file to sign.</p>' +
          '<fluent-button appearance="outline" class="js-download">' + DL + 'Download binary</fluent-button>' +
        '</div>' +
        '<div class="hstep">' +
          '<div class="hstep__num">2</div>' +
          '<h3>Sign it with your certificate</h3>' +
          '<p class="muted">Must be from a trusted authority — not self-signed.</p>' +
        '</div>' +
      '</div>' +
      '<div class="hstep hstep--full">' +
        '<div class="hstep__num">3</div>' +
        '<h3>Submit the signed file</h3>' +
        '<p class="muted">Drop it below to add it to your account.</p>' +
        dz + list + err +
        '<div class="submit-row"><fluent-button appearance="primary" class="js-submit" disabled>Submit &amp; verify</fluent-button></div>' +
      '</div>';
    }

    return '<div class="mflow">' +
      '<div class="mflow__row"><div class="flow__num">1</div><div>' +
        '<h3>Download the binary</h3><p class="muted">A unique binary tied to your account — download this exact file to sign.</p>' +
        '<fluent-button appearance="outline" class="js-download" style="margin-top:10px">' + DL + 'Download binary</fluent-button></div></div>' +
      '<div class="mflow__row"><div class="flow__num">2</div><div>' +
        '<h3>Sign it with your certificate</h3><p class="muted">Must be from a trusted authority — not self-signed.</p></div></div>' +
      '<div class="mflow__row"><div class="flow__num">3</div><div class="mflow__grow">' +
        '<h3>Submit the signed file</h3><p class="muted">Drop it below to add it to your account.</p>' + dz + list + err +
        '<div class="submit-row"><fluent-button appearance="primary" class="js-submit" disabled>Submit &amp; verify</fluent-button></div>' +
      '</div></div></div>';
  }

  function wireFlow(root) {
    var input = root.querySelector(".js-fileinput"), zone = root.querySelector(".js-dropzone"),
        list = root.querySelector(".js-filelist"), submit = root.querySelector(".js-submit"),
        bar = root.querySelector(".js-bar"), download = root.querySelector(".js-download"),
        err = root.querySelector(".js-error");
    pending = [];
    var submitLabel = (submit.textContent || "Submit").trim();
    function setDisabled(v) { submit.toggleAttribute("disabled", !!v); }
    function renderList() {
      list.innerHTML = pending.map(function (f, i) {
        return '<li class="fileitem"><span class="fileitem__ico"><iconify-icon icon="fluent:document-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></span>' +
          '<span class="fileitem__meta"><strong>' + esc(f.name) + '</strong><span class="muted">' + fmtSize(f.size) + '</span></span>' +
          '<button type="button" class="dropzone__clear" data-rm="' + i + '" aria-label="Remove">✕</button></li>';
      }).join("");
      setDisabled(!pending.length);
    }
    function addFiles(fl) {
      Array.prototype.forEach.call(fl, function (f) { if (!pending.some(function (p) { return p.name === f.name && p.size === f.size; })) pending.push(f); });
      renderList();
    }
    function setVerifying(on) {
      // Keep the upload area visually stable; show progress only on the button.
      if (on) { setDisabled(true); submit.innerHTML = '<span class="spinner"></span>Verifying…'; }
      else { submit.textContent = submitLabel; setDisabled(!pending.length); }
    }
    zone.addEventListener("click", function (e) { if (e.target.closest("[data-rm]")) return; input.click(); });
    zone.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
    ["dragover", "dragenter"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("is-over"); }); });
    zone.addEventListener("drop", function (e) { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    list.addEventListener("click", function (e) { var rm = e.target.closest("[data-rm]"); if (rm) { pending.splice(+rm.getAttribute("data-rm"), 1); renderList(); } });
    if (err) err.addEventListener("click", function (e) { if (e.target.closest(".js-error-dismiss")) { err.hidden = true; err.innerHTML = ""; } });
    download.addEventListener("click", function () {
      var nonce = Math.abs(hashStr((state.account ? state.account.email : "x") + Date.now())).toString(16);
      var blob = new Blob(["TDP-VERIFICATION-BINARY\naccount: " + (state.account ? state.account.email : "") + "\nnonce: " + nonce + "\n"], { type: "application/octet-stream" });
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "tdp-verification.bin"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast("Verification binary downloaded — sign it, then drop it above", true);
    });
    submit.addEventListener("click", async function () {
      if (!pending.length) return;
      if (err) { err.hidden = true; err.innerHTML = ""; }
      setVerifying(true);
      var newCerts = 0, accepted = 0, lastCert = null, rejected = [];
      for (var i = 0; i < pending.length; i++) {
        var file = pending[i], info = await inspectFile(file);
        if (!info.offline && info.kind === "authenticode" && !info.signerThumbprint) {
          rejected.push({ name: file.name, reason: "This file isn’t signed. Sign it with a certificate from a trusted Certificate Authority (CA)." });
          continue;
        }
        if (!info.offline && isSelfSigned(info)) {
          rejected.push({ name: file.name, reason: "The certificate is self-signed, not issued by a trusted Certificate Authority (CA). Use a CA-issued code signing certificate." });
          continue;
        }
        // The submitted binary only PROVES the certificate — it is never itself
        // listed as an app. The Apps page is populated solely by discoverApps()
        // below: the real apps installed on this PC that use this certificate.
        var gc = getOrCreateCert(info, file); if (gc.created) newCerts++; accepted++; lastCert = gc.cert;
        gc.cert.verified = true;                          // a signed binary proves ownership of this certificate
      }
      setVerifying(false);
      pending = []; renderList();

      if (accepted) {
        if (state.certs.length) state.verified = true;
        save(); closeModal(); renderAll();
        var msg = newCerts
          ? "Added " + newCerts + " certificate" + (newCerts > 1 ? "s" : "") + (lastCert ? " · " + lastCert.label : "")
          : "Certificate already added" + (lastCert ? " · " + lastCert.label : "");
        if (rejected.length) msg += " · " + rejected.length + " rejected";
        toast(msg);
        // WDP auto-discovers the cert's other apps here. In the Store portal those apps are already
        // surfaced (locked) by discoverStoreApps(); this upload just verifies ownership to unlock them.
        if (!STORE && lastCert && lastCert.thumbKind === "cert") discoverApps(lastCert.thumb, lastCert.id);
        return;
      }
      // Nothing accepted — surface the reasons in place (don't re-render the flow)
      if (rejected.length && err) {
        var icon = '<iconify-icon class="msgbar__icon" icon="fluent:error-circle-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon>';
        var body = rejected.length === 1
          ? '<strong>We couldn’t verify ' + esc(rejected[0].name) + '</strong><p>' + esc(rejected[0].reason) + '</p>'
          : '<strong>We couldn’t verify ' + rejected.length + ' files</strong><ul>' +
            rejected.map(function (r) { return '<li><strong>' + esc(r.name) + '</strong> — ' + esc(r.reason) + '</li>'; }).join("") + '</ul>';
        err.innerHTML = icon + '<div class="msgbar__content">' + body + '</div>' +
          '<button type="button" class="msgbar__dismiss js-error-dismiss" aria-label="Dismiss">✕</button>';
        err.hidden = false;
      } else {
        toast("Nothing added", true);
      }
    });
    renderList();
  }

  function renderCerts() {
    var wrap = $("certsList");
    if (!wrap) return;
    if (!state.certs.length) {
      wrap.innerHTML = STORE
        ? '<div class="empty">' +
            '<img data-theme-image="shield-checkmark" src="assets/shield-checkmark.png" alt="" />' +
            '<strong>Not publishing to the Store?</strong>' +
            '<p class="muted">Add your code signing certificate to get crash analytics and distribution for the apps you’ve signed — no Store listing needed.</p>' +
            '<fluent-button appearance="outline" data-openmodal>' +
              '<iconify-icon slot="start" icon="fluent:add-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon>Add certificate</fluent-button>' +
          '</div>'
        : '<div class="empty">' +
            '<img data-theme-image="shield-checkmark" src="assets/shield-checkmark.png" alt="" />' +
            '<strong>No certificates yet</strong>' +
            '<p class="muted">Add a code signing certificate by submitting a signed binary to confirm your publisher ' +
              'identity and unlock crash analytics for the apps you sign. Any app installed on this PC that uses it is then discovered automatically.</p>' +
            '<fluent-button appearance="primary" data-openmodal>' +
              '<iconify-icon slot="start" icon="fluent:add-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon>Add certificate</fluent-button>' +
          '</div>';
      return;
    }
    wrap.innerHTML = '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Certificate</th><th>Thumbprint</th><th>Apps</th><th>Added</th><th>Status</th><th></th></tr></thead>' +
      '<tbody>' + state.certs.map(certRowHTML).join("") + '</tbody></table></div>';
  }
  function certRowHTML(c) {
    var apps = state.apps.filter(function (a) { return a.certId === c.id; }).length;
    var sub = c.thumbKind === "hash" ? "File fingerprint (backend offline)" : "Authenticode signer";
    var algo = c.thumbKind === "cert" ? "SHA-1" : "SHA-256";
    return '<tr>' +
      '<td><div class="cell-main"><span class="cert-ico' + (c.signed ? "" : " cert-ico--alt") + '">' + (c.signed ? "CS" : "#") + '</span>' +
        '<div><strong>' + esc(c.label) + '</strong><span class="muted">' + sub + '</span></div></div></td>' +
      '<td class="mono">' + fmtThumb(c.thumb) + ' <span class="muted">' + algo + '</span></td>' +
      '<td>' + apps + '</td>' +
      '<td>' + esc(c.added) + '</td>' +
      '<td>' + trustPill(c.trust) + '</td>' +
      '<td><button class="linkbtn" data-removecert="' + c.id + '">Remove</button></td>' +
    '</tr>';
  }

  function appSkeletonHTML(n) {
    var one = '<div class="appcard appcard--sk"><div class="sk sk--icon"></div>' +
      '<div class="sk-lines"><div class="sk sk--line"></div><div class="sk sk--line sk--short"></div></div></div>';
    var s = ""; for (var i = 0; i < n; i++) s += one; return s;
  }
  // Once any app is published, the header's primary CTA becomes "Create new app".
  function updateAppsHeader() {
    if (STORE) {                                          // Store variant: header CTA to add another app
      var cb = $("createAppBtn"), ac = $("addCertBtn"), rs = document.querySelector("#apps [data-rescan]");
      // Empty state already carries the primary CTA in its card — hide the redundant header button there.
      if (cb) { cb.hidden = (state.apps.length === 0 && !scanning); cb.setAttribute("appearance", "primary"); }
      if (ac) ac.hidden = true;
      if (rs) rs.hidden = true;
      return;
    }
    var addCert = $("addCertBtn");
    if (addCert) addCert.setAttribute("appearance", "outline");
  }
  // An app is "in the Store pipeline" once you've taken it toward the Store — whether it's a Draft,
  // In certification (in-review) or Live (published). Cert-discovered / signed-only apps are not.
  function inStorePipeline(a) { return !!a.store || !!a.storeStatus; }
  function renderApps() {
    updateAppsHeader();
    mergePublishIcons();   // pull any logo set during publishing (msstore.apps) into the rows
    var wrap = $("appsList");
    if (STORE) {                                          // Store variant: your Store apps + a WDP-style cert table
      // TEMP DEMO (revert later): after a signed Win32 app is published we "recognize" its code signing
      // certificate and surface the developer's other signed apps in a separate WDP-style table below.
      var sbanner = scanning
        ? '<div class="scan-banner"><span class="spinner"></span>Recognized your code signing certificate — scanning for your other signed apps…</div>'
        : "";
      // Split (shared with WDP): apps in the Store pipeline (Draft / In certification / Live) vs apps
      // still only found via the certificate.
      var below = state.apps.filter(function (a) { return !inStorePipeline(a); });
      var above = state.apps.filter(inStorePipeline);
      if (!above.length && !below.length && !scanning) {
        wrap.innerHTML = '<div class="empty">' +
          '<img data-theme-image="rocket" src="assets/rocket.png" alt="" />' +
          '<strong>Publish your first app</strong>' +
          '<p class="muted">Create an app to reserve its name, add your packages and store listing, ' +
            'and publish to the Microsoft Store — reaching more than a billion Windows devices.</p>' +
          '<fluent-button appearance="primary" data-newapp>' +
            '<iconify-icon slot="start" icon="fluent:add-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon>Add a new app</fluent-button>' +
        '</div>';
        return;
      }
      var html = "";
      if (above.length) html += storeTableHTML(above);
      html += sbanner;
      if (below.length) {
        var dCert = certById(below[0].certId), dVerified = dCert && dCert.verified === true;
        var note = dVerified
          ? '<div class="disc-note"><iconify-icon icon="fluent:certificate-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon>' +
              '<span>Found from the <strong>code signing certificate</strong> of the app you just published — <strong>ownership verified</strong>. Crash analytics and distribution are unlocked.</span></div>'
          : '<div class="disc-note disc-note--verify"><iconify-icon icon="fluent:lock-closed-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon>' +
              '<span><strong>Verify you own this certificate.</strong> These apps are signed by the same certificate as the app you just published. Download our verification file, sign it with that certificate, and upload it to unlock crash analytics &amp; distribution.</span>' +
              '<fluent-button appearance="primary" size="small" data-openmodal>Verify ownership</fluent-button></div>';
        html += '<div class="disc-section">' + note + certGroupsHTML(below) + '</div>';
      }
      wrap.innerHTML = html;
      return;
    }
    var banner = scanning
      ? '<div class="scan-banner"><span class="spinner"></span>Scanning installed apps signed by your certificate…</div>'
      : "";
    var sk = scanning ? appSkeletonHTML(3) : "";
    if (!state.apps.length) {
      wrap.innerHTML = scanning ? (banner + sk) : ('<div class="empty">' +
        '<img data-theme-image="rocket" src="assets/rocket.png" alt="" />' +
        '<strong>No apps yet</strong>' +
        '<p class="muted">Apps signed by your certificates are discovered automatically. Add a ' +
          'certificate and any app installed on this PC that uses it appears here.</p>' +
        '<fluent-button appearance="primary" data-openmodal>Add certificate</fluent-button>' +
      '</div>');
      return;
    }
    // Two tables (shared with the Store portal). The WDP apps page leads with the apps that are IN the
    // Store (Draft / In certification / Live) on top, and shows the signed, not-yet-in-Store apps
    // (grouped by certificate) below.
    var wSigned = state.apps.filter(function (a) { return !inStorePipeline(a); });
    var wStore = state.apps.filter(inStorePipeline);
    var wHtml = banner;
    if (wStore.length) {
      var wNote = '<div class="disc-note"><iconify-icon icon="fluent:storefront-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon>' +
        '<span><strong>In the Microsoft Store.</strong> Installs, crash health and ratings for your apps in the Store — select one to open its analytics.</span></div>';
      wHtml += '<div class="store-block">' + wNote + storeTableHTML(wStore) + '</div>';
    }
    var wSignedHtml = certGroupsHTML(wSigned);
    if (wSignedHtml) wHtml += (wStore.length ? '<div class="disc-section">' + wSignedHtml + '</div>' : wSignedHtml);
    wrap.innerHTML = wHtml + (scanning ? appSkeletonHTML(2) : "");
  }

  // One certificate → one header (signer + trust, shown once) → a table of its apps.
  function certGroupHTML(g) {
    var cert = certById(g.certId), ico, label, pill;
    if (cert) {
      ico = '<span class="cert-ico' + (cert.signed ? "" : " cert-ico--alt") + '">' + (cert.signed ? "CS" : "#") + '</span>';
      label = esc(cert.label);
      pill = cert.trust === "Valid"
        ? '<span class="pill pill--ok pill--sm"><span class="verified-dot"></span>Active</span>'
        : '<span class="pill pill--warn pill--sm">Self-signed</span>';
    } else if (g.subject) {
      ico = '<span class="cert-ico cert-ico--alt">?</span>';
      label = esc(cnOf(g.subject));
      pill = '<span class="pill pill--warn pill--sm">Unidentified cert</span>';
    } else {
      ico = '<span class="cert-ico cert-ico--alt">#</span>';
      label = "No certificate";
      pill = '<span class="pill pill--warn pill--sm">Unsigned</span>';
    }
    var FP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10a2 2 0 0 1 2 2c0 3-.5 5.2-1.3 6.9"/><path d="M12 6a6 6 0 0 1 6 6c0 1.7-.1 3.2-.4 4.7"/><path d="M9 6.8A6 6 0 0 0 6 12c0 3.6-.4 5.6-1.1 7"/><path d="M9 14c0-1.7 1.3-3 3-3"/></svg>';
    var facts = "";
    if (cert) facts += '<span class="certfact" title="Certificate thumbprint">' + FP + '<span class="mono">' + fmtThumb(cert.thumb) + '</span></span>';
    return '<section class="certgroup">' +
      '<header class="certcard">' + ico +
        '<div class="certcard__id">' +
          '<span class="certcard__kicker">Signing certificate</span>' +
          '<div class="certcard__name">' + label + '</div>' +
        '</div>' +
        '<div class="certcard__meta">' + facts + pill + '</div>' +
      '</header>' +
      '<div class="table-wrap"><table class="table apptable">' +
        '<thead><tr><th>App</th><th>Crash analytics</th><th>Download sources</th><th class="col-store">Store</th></tr></thead>' +
        '<tbody>' + g.apps.map(appRowHTML).join("") + '</tbody>' +
      '</table></div>' +
    '</section>';
  }

  // Group a set of apps by their signing certificate (one cert card + one WDP-style table each).
  // Shared by both portals for the "not yet in the Store" apps.
  function certGroupsHTML(apps) {
    var groups = [], byKey = {};
    apps.forEach(function (a) {
      var key = a.certId || (a.signerSubject ? "subj:" + a.signerSubject : "none");
      if (!byKey[key]) { byKey[key] = { certId: a.certId, subject: a.signerSubject, apps: [] }; groups.push(byKey[key]); }
      byKey[key].apps.push(a);
    });
    return groups.map(certGroupHTML).join("");
  }
  // The Store-pipeline table (shared by both portals): every app you've taken toward the Store —
  // Draft, In certification and Live — with the metrics that matter once live (installs, crash
  // rate, rating). Analytics show only for live apps; pre-live rows show the stage instead.
  function storeTableHTML(apps) {
    return '<div class="table-wrap"><table class="table apptable apptable--store">' +
      '<thead><tr><th>App</th><th>Status</th><th>Installs</th><th>Crash rate</th><th>Rating</th><th class="col-store"></th></tr></thead>' +
      '<tbody>' + apps.map(storeAppRowHTML).join("") + '</tbody></table></div>';
  }

  // App-list logo: handles a data URL or remote URL (publishing logo / PWA icon) as well as a
  // bare base64 PNG (cert-discovered icons); falls back to a colored initial when there's none.
  function appIcoImg(a) {
    if (a.icon) {
      var src = /^(data:|https?:|\/)/i.test(a.icon) ? a.icon : ('data:image/png;base64,' + a.icon);
      return '<span class="app-ico app-ico--img"><img src="' + src + '" alt="" /></span>';
    }
    return '<span class="app-ico" style="background:linear-gradient(135deg,' + colorFor(a.name) + ',#0b2a4a)">' + esc(initials(a.name)) + '</span>';
  }
  // Merge a logo saved during publishing (msstore.apps) into the portal's apps, matched by id.
  function mergePublishIcons() {
    var ms; try { ms = JSON.parse(localStorage.getItem("msstore.apps")) || []; } catch (e) { return; }
    if (!Array.isArray(ms)) return;
    var byId = {}; ms.forEach(function (x) { if (x && x.id) byId[x.id] = x; });
    state.apps.forEach(function (a) { var m = byId[a.id]; if (m && m.icon) a.icon = m.icon; });
  }
  // Store portal only: cert-discovered apps stay locked (no crash analytics / distribution) until the
  // developer proves they OWN the signing certificate by signing our verification file. WDP verifies
  // ownership through the Add-certificate modal already, so this gate never applies there.
  function storeLocked(a) {
    if (!STORE || !a.storeDiscovered) return false;
    var c = a.certId ? certById(a.certId) : null;
    return !c || c.verified !== true;
  }
  function appRowHTML(a) {
    var iconHTML = appIcoImg(a);
    var locked = storeLocked(a);
    var created = a.store || a.storeStatus === "in-progress";
    var lockCell = '<span class="celllock" data-openmodal title="Verify certificate ownership to unlock">' +
      '<iconify-icon icon="fluent:lock-closed-16-filled" width="15" height="15" aria-hidden="true"></iconify-icon>Locked</span>';
    var store = locked
      ? lockCell
      : a.store
        ? '<span class="pill pill--ok pill--sm">✓ In Microsoft Store</span>'
        : created
          ? '<fluent-button appearance="outline" size="small" data-continue="' + a.id + '">Continue setup</fluent-button>'
          : '<fluent-button appearance="primary" size="small" data-store="' + a.id + '">Publish to Store</fluent-button>';
    var health = locked ? lockCell
      : '<button class="health" data-analytics="' + a.id + '" data-health="' + a.id + '" title="View crash analytics">' + healthCellInner(a) + '</button>';
    var sources = locked ? lockCell
      : '<div class="srccell"><span class="src-summary">' + srcSummary(a) + '</span>' +
        '<button class="linkbtn" data-sources="' + a.id + '">Manage</button></div>';
    return '<tr' + (created ? ' class="approw--open" data-openapp="' + a.id + '" title="Open publishing flow"' : '') + '>' +
      '<td><div class="cell-main">' + iconHTML +
        '<div><strong>' + esc(a.storeName || a.name) + '</strong>' + (a.size ? '<span class="muted">' + esc(a.size) + '</span>' : '') + '</div></div></td>' +
      '<td>' + health + '</td>' +
      '<td>' + sources + '</td>' +
      '<td class="col-store">' + store + '</td>' +
    '</tr>';
  }

  // Store-developer app row: status, default language, last updated — no WDP crash/sources columns.
  var LANG_LABELS = { "en-US": "English (United States)", "en-GB": "English (United Kingdom)", "es-ES": "Spanish (Spain)",
    "fr-FR": "French (France)", "de-DE": "German (Germany)", "pt-BR": "Portuguese (Brazil)", "it-IT": "Italian (Italy)",
    "ja-JP": "Japanese", "zh-CN": "Chinese (Simplified)", "hi-IN": "Hindi (India)" };
  function langLabel(code) { return LANG_LABELS[code] || code || "English (United States)"; }
  // In-store app row (shared by both portals). Live apps show real analytics and open their
  // dashboard; Draft / In-certification apps show their stage and open the publishing flow.
  function storeAppRowHTML(a) {
    var iconHTML = appIcoImg(a);
    var live = a.store || a.storeStatus === "published";
    var inReview = a.storeStatus === "in-review";
    var rejected = a.storeStatus === "rejected";
    var pill = live
      ? '<span class="pill pill--ok pill--sm">✓ In the Store</span>'
      : rejected
        ? '<span class="pill pill--warn pill--sm">Needs attention</span>'
        : inReview
          ? '<span class="pill pill--info pill--sm">In certification</span>'
          : '<span class="pill pill--ghost pill--sm">Draft</span>';
    // Acquisition / usage / ratings only exist once an app is LIVE; pre-live rows show "—".
    var na = '<span class="muted">—</span>';
    var installs = na, crash = na, rating = na;
    if (live) {
      var acq = acqData(a), ana = anaData(a), rat = ratingsData(a);
      var dot = ana.crashRate >= 5 ? "warn" : "ok";
      installs = '<strong>' + fmtCompact(acq.instTotal) + '</strong>';
      crash = '<span class="metric__row"><span class="health__dot is-' + dot + '"></span>' + ana.crashRate.toFixed(2) + '%</span>';
      rating = '<span class="ratecell"><span class="ratecell__star">★</span><strong>' + rat.avg.toFixed(1) + '</strong> <span class="muted">(' + fmtCompact(rat.total) + ')</span></span>';
    }
    // The row always opens the app's page in its current state (draft / in review / published).
    // For LIVE apps the metric cells (installs, crash rate, rating) instead open that app's analytics.
    var rowTitle = live ? "Open app \u2014 published" : inReview ? "Open app \u2014 in review" : rejected ? "Open app \u2014 needs attention" : "Open app \u2014 draft";
    var metricAttr = live ? ' class="metric-cell" data-analytics="' + a.id + '" title="View analytics"' : '';
    return '<tr class="approw--open" data-openapp="' + a.id + '" title="' + rowTitle + '">' +
      '<td><div class="cell-main">' + iconHTML + '<div><strong>' + esc(a.storeName || a.name) + '</strong>' + (a.size ? '<span class="muted">' + esc(a.size) + '</span>' : '') + '</div></div></td>' +
      '<td>' + pill + '</td>' +
      '<td' + metricAttr + '>' + installs + '</td>' +
      '<td' + metricAttr + '>' + crash + '</td>' +
      '<td' + metricAttr + '>' + rating + '</td>' +
      '<td class="col-store"><span class="rowactions">' +
        (rejected ? '<button class="linkbtn" data-report="' + a.id + '" title="View certification report">View report</button>' : '') +
        '<button class="iconbtn iconbtn--danger" data-delapp="' + a.id + '" title="Delete app" aria-label="Delete app">' +
          '<iconify-icon icon="fluent:delete-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon></button>' +
        '<iconify-icon class="row-chev" icon="fluent:chevron-right-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon></span></td>' +
    '</tr>';
  }

  // Crash health derived from the SAME dummy analytics data the dashboard uses, so the
  // table cell and the Analytics dashboard always agree (crash rate + severity dot).
  function healthCellInner(a) {
    var d = anaData(a);
    return '<span class="health__dot is-' + (d.crashRate >= 5 ? "warn" : "ok") + '"></span>' + d.crashRate.toFixed(2) + '% crash rate';
  }

  /* ================= Analytics — detailed dashboard (dummy data) =================
     Structure modelled on the Microsoft Partner Center health/failures analytics
     (summary cards → Failure Hits timeline → Failure distribution → Failures table →
     per-failure drill-down), tabbed by analytics type. ALL figures here are generated
     DUMMY data, deterministic per app. Charts are inline SVG on Fluent tokens. */
  var analyticsAppId = null, anaTab = "crashes", anaFailure = null, anaPage = 0;
  var anaSearch = "", anaType = "all", anaCause = null, anaSort = { key: "hits", dir: "desc" }, anaDemoState = "live";
  var symSort = { key: "ver", dir: "desc" };
  var anaLogPage = 0, anaLogQuery = "";
  // Crash-analytics view state: date window + symbol uploader (per transcript: 7d/30d/custom, ~24h latency).
  var anaRange = "7d", anaCustom = null, symUp = null, anaFilters = {};
  var SYM_STATES = {
    resolved:    { label: "Resolved",      cls: "ok",   ico: "fluent:checkmark-circle-16-filled" },
    processing:  { label: "Processing",    cls: "info", ico: "fluent:arrow-sync-16-filled" },
    notuploaded: { label: "Not uploaded",  cls: "idle", ico: "fluent:circle-16-regular" },
    action:      { label: "Action needed", cls: "warn", ico: "fluent:warning-16-filled" }
  };
  var SYM_ERR = { code: "SYM_E_PDB_MISMATCH", msg: "The PDB signature (GUID/age) in this upload doesn\u2019t match the binaries you shipped for this version. Rebuild so the symbols match the exact binary, then re-upload the full package (.exe/.dll + .pdb)." };
  // Crash Health is available for every app; the Store analytics (acquisition,
  // usage, ratings) are LOCKED until the app is published to the Microsoft Store.
  var ANA_TABS = [
    { key: "crashes",     label: "Crash",             icon: "fluent:bug-20-regular", free: true },
    { key: "acquisition", label: "Acquisition",       icon: "fluent:arrow-download-20-regular", store: true },
    { key: "usage",       label: "Usage",             icon: "fluent:pulse-20-regular", store: true },
    { key: "ratings",     label: "Ratings & reviews", icon: "fluent:star-20-regular", store: true }
  ];
  // Store-only analytics are LOCKED for apps not yet on the Microsoft Store (e.g. apps brought
  // in via a certificate). Crash Health is always available; the rest unlock on publish.
  function tabLocked(tab, app) { return !!tab.store && !(app && app.store); }
  function lockedAnalyticsHTML(app, tab) {
    return '<div class="ana-locked"><iconify-icon class="ana-locked__ico" icon="fluent:lock-closed-24-regular" width="34" height="34" aria-hidden="true"></iconify-icon>' +
      '<strong>' + esc(tab.label) + ' unlocks on the Microsoft Store</strong>' +
      '<p class="muted">The <strong>Crash</strong> tab is available for every app. ' + esc(tab.label) + ' — plus acquisition, usage and ratings — unlocks once you bring <strong>' + esc(app.name) + '</strong> to the Store.</p>' +
      '<fluent-button appearance="primary" data-store="' + app.id + '"><iconify-icon slot="start" icon="fluent:rocket-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon>Publish to the Store</fluent-button></div>';
  }

  function emptyAnalyticsHTML() {
    return '<div class="empty"><img data-theme-image="data-trending" src="assets/data-trending.png" alt="" />' +
      '<strong>No analytics yet</strong>' +
      '<p class="muted">' + (STORE
        ? 'Analytics appear once an app is live in the Store. Publish an app to start tracking crashes, acquisition, usage, ratings and performance.'
        : 'Add a certificate so your apps appear here, then explore crash and hang analytics.') +
      '</p></div>';
  }

  /* ---- seeded dummy data (stable + distinct per app) ---- */
  function anaRng(seed) { var a = seed >>> 0; return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function fmtCompact(n) { n = Math.round(n); if (n >= 1e6) return (+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)) + "M"; if (n >= 1e3) return (+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)) + "K"; return "" + n; }
  function fmtComma(n) { return Math.round(n).toLocaleString("en-US"); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function pick(rnd, arr) { return arr[(rnd() * arr.length) | 0]; }
  function hexTok(rnd, len) { var h = "0123456789abcdef", s = ""; for (var i = 0; i < len; i++) s += h[(rnd() * 16) | 0]; return s; }
  function wave(rnd, n, base, amp) { var out = [], ph = rnd() * 6.28; for (var i = 0; i < n; i++) { var v = base * (0.62 + 0.38 * Math.sin(ph + i / 2.3)) + (rnd() - 0.5) * amp; out.push(Math.max(base * 0.12, v)); } return out; }

  var DEV_MODELS = ["Surface Pro 9", "Surface Pro 10 for Business", "ThinkPad X1 Yoga Gen 6", "OMEN 30L Desktop GT13", "IdeaPad Gaming 3 15IMH05", "System Product Name", "Dell XPS 15 9530", "ROG Zephyrus G14", "Surface Laptop 6", "P320"];
  var OS_BUILDS = ["10.0.26220", "10.0.26200", "10.0.22631", "10.0.22621"];
  var CPU_MIX = [["Intel Core i5", 39.3], ["Intel Core i7", 24.4], ["Intel Core i3", 11.6], ["AMD (unspecified)", 11.1], ["AMD Ryzen", 3.7], ["Intel Core i9", 1.3], ["Intel Pentium", 2.1], ["Intel Celeron", 1.8], ["Intel (unspecified)", 3.5], ["Other", 1.2]];
  var FAIL_KINDS = [
    { p: "E_DELAYLOAD_MOD_NOT_FOUND_c06d007e_", s: "!Unknown", t: "Crash" },
    { p: "BREAKPOINT_80000003_", s: "!libcef_error", t: "Crash" },
    { p: "FAIL_FAST_FATAL_APP_EXIT_c0000409_", s: "!Unknown", t: "Crash" },
    { p: "INVALID_POINTER_READ_c0000005_", s: "!ProcessFrame", t: "Crash" },
    { p: "STACK_OVERFLOW_c00000fd_", s: "!RtlpAllocateHeap", t: "Crash" },
    { p: "APPLICATION_HANG_BusyHang_", s: "!HANG_QUIESCE", t: "Hang" },
    { p: "APPLICATION_HANG_InputProcessing_", s: "!HANG_INPUT", t: "Hang" },
    { p: "NULL_CLASS_PTR_READ_c0000005_", s: "!CrashHandler", t: "Crash" }
  ];

  var anaCache = {};
  var STACK_FNS = ["Renderer::PaintLayer", "Document::Save", "NetClient::OnResponse", "Heap::Allocate", "View::OnPaint", "Session::Tick", "Codec::DecodeFrame", "Db::Commit"];
  // Win32 vs MSIX: the whole symbols pipeline (upload, coverage %, "unresolved" stacks) is a
  // Win32-only concern. MSIX/APPX packages already ship their symbols inside the package, so
  // those apps always get rich, fully-resolved crash stacks — no symbol upload/coverage/
  // unresolved UI at all. NOTE: apps discovered from a certificate are ALWAYS Win32; MSIX apps
  // only arrive via the publish/Store packaging path (explicit packaging) or a .msix/.appx file.
  function isMsix(app) {
    if (!app) return false;
    if (app.packaging != null) return /msix|appx|uwp|packaged/i.test(String(app.packaging));
    if (typeof app.msix === "boolean") return app.msix;
    return /\.(msix|msixbundle|appx|appxbundle)$/i.test(String(app.file || ""));
  }
  function anaData(app) {
    if (anaCache[app.id]) return anaCache[app.id];
    var msix = isMsix(app);
    var rnd = anaRng(Math.abs(hashStr(app.id + "|" + app.name)) || 1);
    var exe = app.file || (app.name.replace(/\s+/g, "") + ".exe");
    var base = exe.replace(/\.exe$/i, "");
    var crashes = Math.round(8e5 + rnd() * 4e6), hangs = Math.round(1e6 + rnd() * 3e6), crashRate = +(2 + rnd() * 5).toFixed(2);
    var days = 28, labels = [];
    for (var i = 0; i < days; i++) { var dm = 18 + i; labels.push(dm > 31 ? dm - 31 : dm); }
    var series = [
      { name: "Crashes", color: "var(--brand)", values: wave(rnd, days, crashes / days * 9, crashes / days * 5).map(Math.round) },
      { name: "Hangs", color: "var(--magenta)", values: wave(rnd, days, hangs / days * 2.6, hangs / days).map(Math.round) },
      { name: "Memory failures", color: "var(--purple)", values: wave(rnd, days, crashes / days * 0.5, crashes / days * 0.4).map(Math.round) }
    ];
    // App versions, each with its own symbol status (symbols are per app + per version).
    var nver = 4 + ((rnd() * 2) | 0), vmajor = 2 + ((rnd() * 4) | 0), vmin = 1 + ((rnd() * 6) | 0), verNums = [];
    for (var vv = 0; vv < nver; vv++) verNums.push(vmajor + "." + vmin + "." + (nver - vv) + ".0");   // newest first
    var symSeq = ["processing", "resolved", "resolved", "action", "notuploaded", "resolved"], soff = (rnd() * symSeq.length) | 0;
    var vShare = 0.62, versions = verNums.map(function (vn, vi) {
      var st = msix ? "resolved" : symSeq[(vi + soff) % symSeq.length];
      var vf = Math.max(240, Math.round((crashes + hangs) * vShare * (0.5 + rnd() * 0.5))); vShare *= (0.42 + rnd() * 0.3);
      return { ver: vn, failures: vf, sym: st };
    });
    if (!msix) {   // symbol-status variety only matters for Win32; MSIX is always resolved
      if (!versions.some(function (v) { return v.sym === "action"; })) versions[Math.min(2, nver - 1)].sym = "action";
      if (!versions.some(function (v) { return v.sym === "notuploaded"; })) versions[nver - 1].sym = "notuploaded";
      if (versions[0].sym === "notuploaded") versions[0].sym = "processing";   // newest is being worked on
    }
    var symbolHealth = msix ? 100 : Math.round(versions.filter(function (v) { return v.sym === "resolved"; }).length / nver * 100);
    var dist = versions.map(function (v) { return { label: v.ver, value: v.failures }; });
    // Failure buckets \u2014 each tied to a version; resolved iff that version's symbols resolved.
    var failures = [], share = 0.5;
    for (var f = 0; f < 24; f++) {
      var k = FAIL_KINDS[f % FAIL_KINDS.length];
      var vp = versions[(rnd() * Math.min(3, nver)) | 0];
      var resolved = msix || vp.sym === "resolved";
      var type = (f % 6 === 5) ? "Memory" : k.t;
      var cm = k.p.match(/_([0-9a-fA-F]{8})_/), code = cm ? "0x" + cm[1].toUpperCase() : (type === "Hang" ? "Hang" : "0xC0000005");
      var fn = STACK_FNS[(rnd() * STACK_FNS.length) | 0];
      var name = resolved ? (base + "!" + fn) : (k.p + hexTok(rnd, 8) + "_" + base + ".exe" + k.s);
      var fhits = Math.max(2000, Math.round((crashes + hangs) * share * (0.7 + rnd() * 0.5)));
      var fIsNew = vp.ver === verNums[0] && rnd() < 0.5;
      if (fIsNew) fhits = Math.round(fhits * (1.7 + rnd() * 1.3));   // spiking regressions climb fast — surface them
      var fDelta = fIsNew ? (55 + rnd() * 260) : (-50 + rnd() * 120);
      failures.push({ id: "f" + f, name: name, type: type, ver: vp.ver, resolved: resolved, code: code, fn: resolved ? fn : "!Unknown",
        hits: fhits, devices: Math.max(1, Math.round(fhits * (0.10 + rnd() * 0.32))), dPct: +fDelta.toFixed(1), isNew: fIsNew,
        trend: wave(rnd, 8, fhits / 8, fhits / 6).map(Math.round) });
      share *= (0.55 + rnd() * 0.3);
    }
    var sum = failures.reduce(function (m, x) { return m + x.hits; }, 0);
    failures.forEach(function (x) { x.pct = +(x.hits / sum * 100).toFixed(2); });
    failures.sort(function (a, b) { return b.hits - a.hits; });
    (function () {   // guarantee a visible regression on the newest build so "New"/spiking always surfaces
      var nv = verNums[0], flagged = 0;
      for (var fi = 0; fi < failures.length && flagged < 2; fi++) {
        if (failures[fi].ver === nv) { failures[fi].isNew = true; if (failures[fi].dPct < 65) failures[fi].dPct = +(72 + fi * 9).toFixed(1); flagged++; }
      }
    })();
    // Symbol upload history (per-app audit trail, visible to the whole team).
    var users = ["alex@contoso.com", "priya@contoso.com", "sam@fabrikam.com"], hist = [], hn = 3 + ((rnd() * 3) | 0);
    for (var hh = 0; hh < hn; hh++) {
      var hv = versions[hh % nver];
      hist.push({ id: "h" + hh, file: base.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + hv.ver + ".zip",
        ver: hv.ver, status: hv.sym === "notuploaded" ? "action" : hv.sym, size: (18 + ((rnd() * 60) | 0)) + " MB",
        by: pick(rnd, users), date: "05/" + pad2(17 - hh) + "/2026" });
    }
    return (anaCache[app.id] = { crashes: crashes, hangs: hangs, crashRate: crashRate, hits: { labels: labels, series: series },
      dist: dist, failures: failures, versions: versions, symbolHealth: symbolHealth, history: hist, exe: exe, base: base });
  }
  function failureDetail(app, f) {
    var rnd = anaRng(Math.abs(hashStr(app.id + "|" + f.id)) || 1), days = 28, labels = [];
    for (var i = 0; i < days; i++) { var dm = 18 + i; labels.push(dm > 31 ? dm - 31 : dm); }
    var series = [{ name: f.type + "s", color: "var(--brand)", values: wave(rnd, days, f.hits / days * 6, f.hits / days * 3).map(Math.round) }];
    var DTYPE = ["Desktop", "Laptop", "Server", "Tablet", "Workstation"], log = [];
    for (var r = 0; r < 26; r++) log.push({ id: "o" + r, date: pad2(6 + ((rnd() * 2) | 0)) + "/" + pad2(1 + ((rnd() * 27) | 0)) + "/2026 " + pad2(1 + ((rnd() * 11) | 0)) + ":" + pad2((rnd() * 59) | 0) + " " + (rnd() < 0.5 ? "AM" : "PM"), ver: f.ver, dev: pick(rnd, DTYPE), model: pick(rnd, DEV_MODELS), os: pick(rnd, OS_BUILDS) });
    return { hits: { labels: labels, series: series }, log: log, cpu: CPU_MIX };
  }

  /* ---- inline SVG charts (Fluent-token styled) ---- */
  function niceMax(max) { var step = Math.pow(10, Math.floor(Math.log10(max || 1))); return Math.ceil((max || 1) / step) * step; }
  function chartLine(o) {
    var W = 840, H = o.h || 260, pl = 46, pr = o.right ? 48 : 16, pt = 14, pb = 30, iw = W - pl - pr, ih = H - pt - pb;
    var mn = o.yMin || 0, mx = o.yMax;
    if (mx == null) { mx = 1; o.series.forEach(function (s) { s.values.forEach(function (v) { if (v > mx) mx = v; }); }); mx = niceMax(mx); }
    var span = (mx - mn) || 1, fmt = o.fmt || fmtCompact;
    var n = o.series[0].values.length;
    function X(i) { return pl + (n <= 1 ? 0 : iw * i / (n - 1)); }
    function Y(v) { return pt + ih - ih * ((v - mn) / span); }
    var R = null, rmn, rspan, rfmt;
    if (o.right) {
      rmn = o.right.yMin || 0; var rmx = o.right.yMax;
      if (rmx == null) { rmx = 1; o.right.values.forEach(function (v) { if (v > rmx) rmx = v; }); rmx = niceMax(rmx); }
      rspan = (rmx - rmn) || 1; rfmt = o.right.fmt || fmtCompact;
      R = function (v) { return pt + ih - ih * ((v - rmn) / rspan); };
    }
    var grid = "", ylab = "", rlab = "";
    for (var g = 0; g <= 4; g++) { var gy = pt + ih * g / 4;
      grid += '<line x1="' + pl + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + gy.toFixed(1) + '" class="chart-grid"/>';
      ylab += '<text x="' + (pl - 8) + '" y="' + (gy + 4).toFixed(1) + '" class="chart-axis chart-axis--y">' + fmt(mn + span * (1 - g / 4)) + '</text>';
      if (o.right) rlab += '<text x="' + (W - pr + 8) + '" y="' + (gy + 4).toFixed(1) + '" class="chart-axis chart-axis--y2">' + rfmt(rmn + rspan * (1 - g / 4)) + '</text>'; }
    var xlab = "", stepX = Math.ceil(n / 8);
    for (var xi = 0; xi < n; xi += stepX) xlab += '<text x="' + X(xi).toFixed(1) + '" y="' + (H - 10) + '" class="chart-axis">' + esc("" + o.labels[xi]) + '</text>';
    var paths = o.series.map(function (s, si) {
      var pts = s.values.map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join(" ");
      var area = (o.area && si === 0) ? '<polygon points="' + pl + ',' + (pt + ih) + ' ' + pts + ' ' + (pl + iw) + ',' + (pt + ih) + '" fill="url(#agrad)"/>' : "";
      return area + '<polyline points="' + pts + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    }).join("");
    if (o.right) {
      var rpts = o.right.values.map(function (v, i) { return X(i).toFixed(1) + "," + R(v).toFixed(1); }).join(" ");
      paths += '<polyline points="' + rpts + '" fill="none" stroke="' + o.right.color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img"><defs><linearGradient id="agrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--brand)" stop-opacity=".26"/><stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>' + grid + ylab + rlab + paths + xlab + '</svg>';
  }
  function chartBars(o) {
    var W = 840, H = o.h || 280, pl = 46, pr = 16, pt = 16, pb = 40, iw = W - pl - pr, ih = H - pt - pb;
    var mx = 1; o.bars.forEach(function (b) { if (b.value > mx) mx = b.value; }); mx = niceMax(mx);
    var n = o.bars.length, gap = iw / n, bw = gap * 0.56;
    var grid = "", ylab = "";
    for (var g = 0; g <= 4; g++) { var gy = pt + ih * g / 4;
      grid += '<line x1="' + pl + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + gy.toFixed(1) + '" class="chart-grid"/>';
      ylab += '<text x="' + (pl - 8) + '" y="' + (gy + 4).toFixed(1) + '" class="chart-axis chart-axis--y">' + fmtCompact(mx * (1 - g / 4)) + '</text>'; }
    var bars = o.bars.map(function (b, i) {
      var cx = pl + gap * i + (gap - bw) / 2, h = Math.max(1, ih * (b.value / mx)), y = pt + ih - h, mid = cx + bw / 2;
      return '<rect x="' + cx.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" class="chart-bar"/>' +
        '<text x="' + mid.toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" class="chart-axis chart-barval">' + fmtCompact(b.value) + '</text>' +
        '<text x="' + mid.toFixed(1) + '" y="' + (H - 15) + '" class="chart-axis">' + esc(b.label) + '</text>';
    }).join("");
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">' + grid + ylab + bars + '</svg>';
  }
  function spark(values, color) {
    var W = 280, H = 54, mx = -Infinity, mn = Infinity;
    values.forEach(function (v) { if (v > mx) mx = v; if (v < mn) mn = v; });
    var n = values.length, rng = (mx - mn) || 1;
    var pts = values.map(function (v, i) { return (W * i / (n - 1)).toFixed(1) + "," + (H - 5 - (H - 11) * (v - mn) / rng).toFixed(1); }).join(" ");
    return '<svg class="cardspark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img"><polygon points="0,' + H + ' ' + pts + ' ' + W + ',' + H + '" fill="' + color + '" opacity=".12"/><polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2"/></svg>';
  }

  /* ---- render ---- */
  function anaTabsHTML(app) {
    return '<div class="anatabs" role="tablist">' + ANA_TABS.map(function (t) {
      var locked = tabLocked(t, app);
      return '<button class="anatab' + (t.key === anaTab ? " is-active" : "") + (locked ? " is-locked" : "") + '" data-anatab="' + t.key + '" role="tab"' + (locked ? ' title="Available once the app is on the Store"' : "") + '>' +
        '<iconify-icon icon="' + t.icon + '" width="18" height="18" aria-hidden="true"></iconify-icon>' + esc(t.label) +
        (locked ? '<iconify-icon class="anatab__lock" icon="fluent:lock-closed-16-filled" width="12" height="12" aria-hidden="true"></iconify-icon>' : "") + '</button>';
    }).join("") + '</div>';
  }
  function apanel(title, body, sub) {
    return '<section class="apanel"><header class="apanel__head"><h3>' + title + '</h3>' +
      '<iconify-icon class="apanel__i" icon="fluent:info-20-regular" width="16" height="16" aria-hidden="true"></iconify-icon></header>' +
      (sub ? '<p class="apanel__sub muted">' + sub + '</p>' : "") + '<div class="apanel__body">' + body + '</div></section>';
  }
  function sumCard(label, val, sub, series, color, tag) {
    return '<div class="sumcard"><span class="sumcard__label">' + label + (tag ? ' <span class="pill pill--ghost pill--sm sa-tag">Preview</span>' : "") + '</span>' +
      '<strong class="sumcard__big">' + val + '</strong><span class="sumcard__sub muted">' + sub + '</span>' +
      (series ? spark(series, color) : "") + '</div>';
  }
  function chartLegend(series) {
    return '<div class="chart-legend">' + series.map(function (s) {
      var tot = s.values.reduce(function (m, v) { return m + v; }, 0);
      return '<span class="chart-leg"><span class="chart-leg__dot" style="background:' + s.color + '"></span>' + esc(s.name) + ' (' + fmtCompact(tot) + ')</span>';
    }).join("") + '</div>';
  }
  function legendDots(items) {
    return '<div class="chart-legend">' + items.map(function (s) {
      return '<span class="chart-leg"><span class="chart-leg__dot" style="background:' + s.color + '"></span>' + esc(s.name) + '</span>';
    }).join("") + '</div>';
  }
  function panelStats(items) {
    return '<div class="pstats">' + items.map(function (s) {
      return '<div class="pstat"><span class="pstat__label muted">' + esc(s.label) + '</span>' +
        '<strong class="pstat__val">' + esc(s.val) + '</strong>' + (s.sub ? '<span class="pstat__sub muted">' + esc(s.sub) + '</span>' : "") + '</div>';
    }).join("") + '</div>';
  }
  // 100%-stacked area (app version adoption). series: [{name,color,values(0-100)}].
  function chartStack(o) {
    var W = 840, H = o.h || 260, pl = 46, pr = 16, pt = 14, pb = 30, iw = W - pl - pr, ih = H - pt - pb;
    var n = o.series[0].values.length;
    function X(i) { return pl + (n <= 1 ? 0 : iw * i / (n - 1)); }
    function Y(v) { return pt + ih - ih * (v / 100); }
    var grid = "", ylab = "";
    for (var g = 0; g <= 5; g++) { var gy = pt + ih * g / 5;
      grid += '<line x1="' + pl + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + gy.toFixed(1) + '" class="chart-grid"/>';
      ylab += '<text x="' + (pl - 8) + '" y="' + (gy + 4).toFixed(1) + '" class="chart-axis chart-axis--y">' + (100 - g * 20) + '%</text>'; }
    var cum = []; for (var c = 0; c < n; c++) cum.push(0);
    var areas = o.series.map(function (s) {
      var top = [], bot = [];
      for (var i = 0; i < n; i++) { bot.push(cum[i]); cum[i] += s.values[i]; top.push(cum[i]); }
      var tp = top.map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join(" ");
      var bp = bot.map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); }).reverse().join(" ");
      return '<polygon points="' + tp + ' ' + bp + '" fill="' + s.color + '" opacity=".9"/>';
    }).join("");
    var xlab = "", stepX = Math.ceil(n / 8);
    for (var xi = 0; xi < n; xi += stepX) xlab += '<text x="' + X(xi).toFixed(1) + '" y="' + (H - 10) + '" class="chart-axis">' + esc("" + o.labels[xi]) + '</text>';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">' + grid + ylab + areas + xlab + '</svg>';
  }

  /* ---- Acquisition: full dashboard, modelled on Partner Center → Insights → Acquisitions ---- */
  var acqCache = {};
  function acqData(app) {
    if (acqCache[app.id]) return acqCache[app.id];
    var rnd = anaRng(Math.abs(hashStr(app.id + "|acq|" + app.name)) || 1), days = 28, labels = [], i;
    for (i = 0; i < days; i++) { var dm = 18 + i; labels.push(dm > 31 ? dm - 31 : dm); }
    function sum(a) { return a.reduce(function (m, v) { return m + v; }, 0); }
    var pv = wave(rnd, days, 42000, 20000).map(Math.round);
    var inst = wave(rnd, days, 2600, 1100).map(Math.round);
    var succRate = [], abortRate = [], convRate = [];
    for (i = 0; i < days; i++) {
      succRate.push(+(99.1 + rnd() * 0.85).toFixed(2));
      abortRate.push(+(0.45 + rnd() * 0.95).toFixed(2));
      convRate.push(+(inst[i] / Math.max(1, pv[i]) * 100).toFixed(2));
    }
    var failCnt = wave(rnd, days, 11, 14).map(Math.round);
    var pvTotal = sum(pv), instTotal = sum(inst);
    var funnel = [
      { label: "Page views", value: pvTotal },
      { label: "Install attempts", value: Math.round(instTotal * 1.022) },
      { label: "Successful installs", value: instTotal },
      { label: "First time launches from Store", value: Math.round(instTotal * 0.46) }
    ];
    var CAMP = ["Photos", "acom", "member_notification_upsell", "Windows", "ffMainEntry", "Holiday2026"], campaigns = [], cbase = instTotal * 0.013;
    for (i = 0; i < CAMP.length; i++) {
      var ci = Math.max(4, Math.round(cbase * (0.8 + rnd() * 0.5)));
      campaigns.push({ name: CAMP[i], installs: ci, trend: wave(rnd, days, ci / days * 5, ci / days * 4).map(Math.round) });
      cbase *= (0.66 + rnd() * 0.2);
    }
    campaigns.sort(function (a, b) { return b.installs - a.installs; });
    var GEO = ["India", "United States", "Unknown", "United Kingdom", "Indonesia", "Brazil", "France", "Germany"];
    var GW = [0.31, 0.20, 0.14, 0.034, 0.027, 0.025, 0.019, 0.016], geo = [];
    for (i = 0; i < GEO.length; i++) geo.push({ country: GEO[i], installs: Math.round(instTotal * GW[i] * (0.9 + rnd() * 0.2)) });
    var gsum = sum(geo.map(function (g) { return g.installs; }));
    geo.forEach(function (g) { g.pct = +(g.installs / gsum * 100).toFixed(2); });
    geo.sort(function (a, b) { return b.installs - a.installs; });
    return (acqCache[app.id] = {
      labels: labels, pv: pv, inst: inst, succRate: succRate, abortRate: abortRate, failCnt: failCnt, convRate: convRate,
      pvTotal: pvTotal, instTotal: instTotal, conv: +(instTotal / pvTotal * 100).toFixed(2), succ: +(sum(succRate) / days).toFixed(2),
      funnel: funnel, campaigns: campaigns, geo: geo
    });
  }
  function pctFmt(v) { return (+v.toFixed(v < 10 ? 1 : 0)) + "%"; }
  function acqFunnel(steps) {
    var mx = steps[0].value || 1;
    return '<div class="funnel">' + steps.map(function (s) {
      return '<div class="funnel__row"><span class="funnel__label">' + esc(s.label) + '</span>' +
        '<span class="funnel__track"><span class="funnel__fill" style="width:' + Math.max(2, s.value / mx * 100).toFixed(1) + '%"></span></span>' +
        '<span class="funnel__val">' + fmtCompact(s.value) + '</span></div>';
    }).join("") + '</div>';
  }
  function campaignBody(d) {
    var rows = d.campaigns.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td class="num">' + fmtComma(c.installs) + '</td></tr>'; }).join("");
    var table = '<div class="table-wrap"><table class="atable"><thead><tr><th>Campaign name</th><th class="num">Installs</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    var COL = ["var(--brand)", "#C239B3", "#f7b955"];
    var series = d.campaigns.slice(0, 3).map(function (c, i) { return { name: c.name, color: COL[i], values: c.trend }; });
    return '<div class="campgrid"><div>' + table + '</div><div>' + chartLine({ series: series, labels: d.labels, h: 230 }) + chartLegend(series) + '</div></div>';
  }
  function geoBody(d) {
    var rows = d.geo.map(function (g) {
      return '<tr><td>' + esc(g.country) + '</td><td class="num">' + fmtComma(g.installs) + ' <span class="muted">(' + g.pct.toFixed(2) + '%)</span></td></tr>';
    }).join("");
    return '<div class="table-wrap"><table class="atable"><thead><tr><th>Country/region</th><th class="num">Installs</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function acquisitionTab(app) {
    var d = acqData(app), L = d.labels, blue = "var(--brand)";
    function legendOne(name, color, values) { return chartLegend([{ name: name, color: color, values: values }]); }
    var cards = '<div class="sumrow sumrow--4">' +
      sumCard("Page views", fmtCompact(d.pvTotal), "Last 28 days", d.pv, blue) +
      sumCard("Installs", fmtCompact(d.instTotal), "Last 28 days", d.inst, "#4ad17a") +
      sumCard("Conversion", d.conv.toFixed(2) + "%", "Installs by page views", d.convRate, "#f7b955") +
      sumCard("Install success rate", d.succ.toFixed(2) + "%", "Last 28 days", d.succRate, "#5ad1cd") + '</div>';
    return cards +
      apanel("Acquisition funnel", acqFunnel(d.funnel), "View by source type") +
      apanel("Page views", chartLine({ series: [{ name: "All", color: blue, values: d.pv }], labels: L, area: true }) + legendOne("All", blue, d.pv)) +
      apanel("Installs", chartLine({ series: [{ name: "All", color: blue, values: d.inst }], labels: L, area: true }) + legendOne("All", blue, d.inst)) +
      apanel("Install success rate", chartLine({ series: [{ name: "Success rate", color: "#4ad17a", values: d.succRate }], labels: L, yMin: 95, yMax: 100, fmt: pctFmt })) +
      '<div class="apanel-grid">' +
        apanel("User initiated aborts", chartLine({ series: [{ name: "All", color: blue, values: d.abortRate }], labels: L, fmt: pctFmt })) +
        apanel("Install failures", chartLine({ series: [{ name: "All", color: "#C239B3", values: d.failCnt }], labels: L }) + legendOne("All", "#C239B3", d.failCnt)) +
      '</div>' +
      apanel("Conversion", chartLine({ series: [{ name: "All", color: blue, values: d.convRate }], labels: L, fmt: pctFmt }), "Installs by page views") +
      apanel("Custom campaign performance", campaignBody(d)) +
      apanel("Geographical spread", geoBody(d));
  }

  /* ---- Usage: full dashboard, modelled on Partner Center → Insights → Usage ---- */
  var usgCache = {};
  function usageData(app) {
    if (usgCache[app.id]) return usgCache[app.id];
    var rnd = anaRng(Math.abs(hashStr(app.id + "|usage")) || 1), days = 28, labels = [], i;
    for (i = 0; i < days; i++) { var dm = 18 + i; labels.push(dm > 31 ? dm - 31 : dm); }
    function sum(a) { return a.reduce(function (m, v) { return m + v; }, 0); }
    function avg(a) { return sum(a) / a.length; }
    var mad = wave(rnd, days, 110000, 5000).map(Math.round);
    var newMonthly = wave(rnd, days, 39600, 3000).map(Math.round);
    var dad = wave(rnd, days, 10500, 4200).map(Math.round);
    var newDaily = wave(rnd, days, 1280, 420).map(Math.round);
    var sessions = wave(rnd, days, 15600, 5200).map(Math.round);
    var avgMin = [], stickiness = [];
    for (i = 0; i < days; i++) { avgMin.push(+(48 + rnd() * 9).toFixed(2)); stickiness.push(+(7.6 + rnd() * 3.1).toFixed(2)); }
    var totHours = wave(rnd, days, 12500, 6000).map(Math.round);
    var uninstalls = wave(rnd, days, 312, 55).map(Math.round);
    var madAvg = Math.round(avg(mad)), sessTotal = sum(sessions), totalDevices = Math.round(madAvg * 2.75);
    var VER = ["2.1.1.0", "2.1.0.0", "1.0.19.0", "1.0.18.0", "1.0.17.0", "1.0.15.0", "1.0.0.0"];
    var VW = [0.9953, 0.0039, 0.0006, 0.0001, 0.00005, 0.00003, 0.00002];
    var verRows = VER.map(function (v, k) {
      return { ver: v, devices: Math.max(2, Math.round(totalDevices * VW[k])), sessions: Math.max(2, Math.round(sessTotal * VW[k] * (0.98 + rnd() * 0.04))) };
    });
    var devSum = sum(verRows.map(function (r) { return r.devices; })), sesSum = sum(verRows.map(function (r) { return r.sessions; }));
    verRows.forEach(function (r) { r.dPct = +(r.devices / devSum * 100).toFixed(2); r.sPct = +(r.sessions / sesSum * 100).toFixed(2); });
    var ADOPT_COL = ["#5b8def", "#3fb950", "#a371f7", "#d29922", "#39c5cf"];
    var adopt = VER.slice(0, 5).map(function (v, k) { return { name: v, color: ADOPT_COL[k], values: [] }; });
    for (i = 0; i < days; i++) {
      var top = 97.5 + rnd() * 1.6; adopt[0].values.push(top);
      var rest = 100 - top, parts = [0.55, 0.24, 0.13, 0.08];
      for (var j = 1; j < adopt.length; j++) adopt[j].values.push(+(rest * parts[j - 1]).toFixed(3));
    }
    var CO = [["India", 0.451, 0.4706], ["United States", 0.1339, 0.1172], ["Japan", 0.0343, 0.0331], ["Indonesia", 0.0248, 0.0236], ["Mexico", 0.0261, 0.0233], ["South Africa", 0.0188, 0.0182], ["United Kingdom", 0.0202, 0.018]];
    var coRows = CO.map(function (c) {
      return { country: c[0], devices: Math.round(totalDevices * c[1] * (0.95 + rnd() * 0.1)), dPct: +(c[1] * 100).toFixed(2), sessions: Math.round(sessTotal * c[2] * (0.95 + rnd() * 0.1)), sPct: +(c[2] * 100).toFixed(2) };
    });
    return (usgCache[app.id] = {
      labels: labels, mad: mad, newMonthly: newMonthly, dad: dad, newDaily: newDaily, sessions: sessions,
      avgMin: avgMin, totHours: totHours, stickiness: stickiness, uninstalls: uninstalls,
      madAvg: madAvg, newMonthlyAvg: Math.round(avg(newMonthly)), dadAvg: Math.round(avg(dad)), newDailyAvg: Math.round(avg(newDaily)),
      sessTotal: sessTotal, avgEng: +avg(avgMin).toFixed(2), totEngHours: sum(totHours), dadMad: +avg(stickiness).toFixed(2), uninstallTotal: sum(uninstalls),
      verRows: verRows, adopt: adopt, coRows: coRows
    });
  }
  function distTable(headA, rows) {
    return '<div class="table-wrap"><table class="atable"><thead><tr><th>' + headA + '</th><th class="num">Active devices</th><th class="num">Sessions</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.label) + '</td><td class="num">' + fmtComma(r.devices) + ' <span class="muted">(' + r.dPct.toFixed(2) + '%)</span></td>' +
          '<td class="num">' + fmtComma(r.sessions) + ' <span class="muted">(' + r.sPct.toFixed(2) + '%)</span></td></tr>';
      }).join("") + '</tbody></table></div>';
  }
  function usageTab(app) {
    var d = usageData(app), L = d.labels, blue = "var(--brand)", pink = "#e3008c";
    var cards = '<div class="sumrow sumrow--4">' +
      sumCard("Monthly active devices (Avg)", fmtCompact(d.madAvg), "Last 30 days", d.mad, blue) +
      sumCard("Sessions (Total)", fmtCompact(d.sessTotal), "Last 30 days", d.sessions, blue) +
      sumCard("Avg engagement duration", d.avgEng + " min", "Last 30 days", d.avgMin, "#5ad1cd") +
      sumCard("DAD/MAD", d.dadMad + "%", "Last 30 days", d.stickiness, "#f7b955") + '</div>';
    var monthly = panelStats([{ label: "Monthly active devices (Avg)", val: fmtCompact(d.madAvg) }, { label: "New monthly devices (Avg)", val: fmtCompact(d.newMonthlyAvg) }]) +
      chartLine({ series: [{ name: "Monthly active devices", color: blue, values: d.mad }, { name: "New monthly devices", color: pink, values: d.newMonthly }], labels: L }) +
      legendDots([{ name: "Monthly active devices", color: blue }, { name: "New monthly devices", color: pink }]);
    var daily = panelStats([{ label: "Daily active devices (Avg)", val: fmtCompact(d.dadAvg) }, { label: "New daily devices (Avg)", val: fmtCompact(d.newDailyAvg) }]) +
      chartLine({ series: [{ name: "Daily active devices", color: blue, values: d.dad }, { name: "New daily devices", color: pink, values: d.newDaily }], labels: L }) +
      legendDots([{ name: "Daily active devices", color: blue }, { name: "New daily devices", color: pink }]);
    var sessions = panelStats([{ label: "Sessions (Total)", val: fmtCompact(d.sessTotal), sub: "in last 30 days" }]) +
      chartLine({ series: [{ name: "Device sessions", color: blue, values: d.sessions }], labels: L }) + legendDots([{ name: "Device sessions", color: blue }]);
    var engagement = panelStats([{ label: "Average engagement duration", val: d.avgEng + " min", sub: "in last 30 days" }, { label: "Total engagement duration", val: fmtCompact(d.totEngHours) + " hours", sub: "in last 30 days" }]) +
      chartLine({ series: [{ name: "Total engagement hours", color: pink, values: d.totHours }], labels: L, right: { values: d.avgMin, color: blue, yMin: 46, yMax: 58, fmt: function (v) { return Math.round(v); } } }) +
      legendDots([{ name: "Average engagement minutes", color: blue }, { name: "Total engagement hours", color: pink }]);
    var adoption = chartStack({ series: d.adopt, labels: L }) + legendDots(d.adopt.map(function (s) { return { name: s.name, color: s.color }; }));
    var stick = panelStats([{ label: "DAD/MAD", val: d.dadMad + "%" }]) +
      chartLine({ series: [{ name: "DAD/MAD", color: blue, values: d.stickiness }], labels: L, fmt: pctFmt }) + legendDots([{ name: "DAD/MAD", color: blue }]);
    var uninstall = panelStats([{ label: "User-initiated uninstalls", val: fmtCompact(d.uninstallTotal) }]) +
      chartLine({ series: [{ name: "User-initiated uninstalls", color: blue, values: d.uninstalls }], labels: L }) + legendDots([{ name: "User-initiated uninstalls", color: blue }]);
    var verRows = d.verRows.map(function (r) { return { label: r.ver, devices: r.devices, dPct: r.dPct, sessions: r.sessions, sPct: r.sPct }; });
    var coRows = d.coRows.map(function (r) { return { label: r.country, devices: r.devices, dPct: r.dPct, sessions: r.sessions, sPct: r.sPct }; });
    return cards +
      '<div class="apanel-grid">' + apanel("Monthly activity", monthly) + apanel("Daily activity", daily) + '</div>' +
      '<div class="apanel-grid">' + apanel("Sessions", sessions) + apanel("Engagement duration", engagement) + '</div>' +
      apanel("App version adoption", adoption) +
      '<div class="apanel-grid">' + apanel("DAD/MAD (Stickiness)", stick) + apanel("User-initiated uninstalls", uninstall) + '</div>' +
      '<div class="apanel-grid">' + apanel("Distribution by app version", distTable("App version", verRows)) + apanel("Distribution by country", distTable("Country/region", coRows)) + '</div>';
  }

  /* ---- Ratings & reviews: full dashboard, modelled on Partner Center → Insights → Ratings & reviews ---- */
  var REVIEW_POOL = [
    { stars: 3, title: "часто лагает", body: "очень любила приложение. Работала только на нем, будь то макеты или простой текст. всё удобно и понятно. не знаю из-за чего, но уже неделю не могу войти в мои файлы! это ужас, все корректировки сохранены в приложении, работа остановилась и никакого аналога…", ver: "2.1.1.0", country: "Russia", name: "Марианна", date: "Tue, Jun 02, 2026 15:50:39 UTC" },
    { stars: 1, title: "WORST PIECE OF **** BY EXCUSE OF A COMPANY", body: "its basically a trojan which wont be marked as virus", ver: "—", country: "India", name: "Sourav", date: "Wed, May 20, 2026 23:10:30 UTC" },
    { stars: 2, title: "good but poor performance", body: "its a great app but lately it has started lagging. whenever i try to open the application it shows that its being used in another application and doesn’t open. a lot of my works are on going on it which i had to start from scratch in another app like canva and photoshop.", ver: "2.1.1.0", country: "India", name: "Meenu", date: "Tue, May 05, 2026 19:58:10 UTC" },
    { stars: 5, title: "Love it for quick edits", body: "Best lightweight editor for my Surface — launches fast and the templates are great. Highly recommend.", ver: "2.1.1.0", country: "United States", name: "Jordan", date: "Sun, Apr 28, 2026 09:12:44 UTC" },
    { stars: 4, title: "Solid, a few gaps", body: "Does what it says and the UI is clean. Would love more export formats and an offline mode.", ver: "2.1.0.0", country: "Brazil", name: "Lucas", date: "Sun, Apr 12, 2026 14:03:21 UTC" }
  ];
  var ratCache = {};
  function ratingsData(app) {
    if (ratCache[app.id]) return ratCache[app.id];
    var rnd = anaRng(Math.abs(hashStr(app.id + "|rat")) || 1), days = 28, labels = [], i;
    for (i = 0; i < days; i++) { var dm = 18 + i; labels.push(dm > 31 ? dm - 31 : dm); }
    var total = 3500 + Math.round(rnd() * 200);
    var DIST = [["5", 0.58], ["4", 0.14], ["3", 0.07], ["2", 0.04], ["1", 0.17]];
    var stars = DIST.map(function (s) { var c = Math.round(total * s[1]); var orig = Math.round(c * (0.78 + rnd() * 0.1)); return { star: s[0], count: c, pct: s[1] * 100, orig: orig, rev: c - orig }; });
    var realTotal = stars.reduce(function (m, s) { return m + s.count; }, 0);
    var avg = +((5 * stars[0].count + 4 * stars[1].count + 3 * stars[2].count + 2 * stars[3].count + 1 * stars[4].count) / realTotal).toFixed(2);
    var orig = stars.reduce(function (m, s) { return m + s.orig; }, 0), rev = realTotal - orig;
    var avgSeries = [], totSeries = [];
    for (i = 0; i < days; i++) { avgSeries.push(+(3 + rnd() * 1.8).toFixed(2)); totSeries.push(Math.round(20 + rnd() * 45)); }
    var GEO = [["United States", 4, 835, 84], ["India", 4.2, 568, 38], ["Brazil", 4, 207, 33], ["United Kingdom", 3.6, 166, 36], ["Russia", 3.6, 152, 21], ["Mexico", 4.1, 100, 10]];
    var geo = GEO.map(function (g) { return { country: g[0], avg: g[1], ratings: g[2], reviews: g[3] }; });
    return (ratCache[app.id] = { labels: labels, total: realTotal, stars: stars, avg: avg, orig: orig, rev: rev, avgSeries: avgSeries, totSeries: totSeries, reviews: REVIEW_POOL, geo: geo });
  }
  function starRowHTML(n, cls) {
    var full = Math.round(n), s = "";
    for (var i = 1; i <= 5; i++) s += '<span class="rstar' + (i <= full ? " is-on" : "") + '">★</span>';
    return '<div class="starrow' + (cls ? " " + cls : "") + '">' + s + '</div>';
  }
  function ratingBars(stars) {
    var mx = stars.reduce(function (m, s) { return Math.max(m, s.count); }, 1);
    return '<div class="ratbars">' + stars.map(function (s) {
      return '<div class="ratbar"><span class="ratbar__star">' + s.star + ' ★</span>' +
        '<span class="ratbar__track"><span class="ratbar__fill" style="width:' + (s.count / mx * 100).toFixed(1) + '%">' +
          '<span class="ratbar__blue" style="width:' + (s.orig / s.count * 100).toFixed(1) + '%"></span></span></span>' +
        '<span class="ratbar__val">' + fmtComma(s.count) + ' (' + Math.round(s.pct) + '%)</span></div>';
    }).join("") + '</div>';
  }
  function ratingsTab(app) {
    var d = ratingsData(app), L = d.labels, blue = "var(--brand)", pink = "#e3008c";
    var breakdown = '<div class="ratbreak"><div class="ratbreak__sum">' +
      '<span class="muted">Average</span><strong class="ratbreak__avg">' + d.avg.toFixed(2) + '</strong>' + starRowHTML(d.avg) +
      '<span class="muted ratbreak__lbl">Total Ratings</span><strong class="ratbreak__tot">' + fmtComma(d.total) + '</strong>' +
      '<div class="ratbreak__split"><div><span class="muted">Original rating</span><strong>' + fmtCompact(d.orig) + '</strong></div>' +
        '<div><span class="muted">Revised rating</span><strong>' + fmtComma(d.rev) + '</strong></div></div></div>' +
      '<div class="ratbreak__bars">' + ratingBars(d.stars) + '</div></div>';
    var overtime = panelStats([{ label: "Average rating", val: d.avg.toFixed(2) }, { label: "Total ratings", val: fmtComma(d.total) }]) +
      chartLine({ series: [{ name: "Total Ratings", color: blue, values: d.totSeries }], labels: L, area: true, right: { values: d.avgSeries, color: pink, yMin: 0, yMax: 5, fmt: function (v) { return v.toFixed(0); } } }) +
      legendDots([{ name: "Total Ratings", color: blue }, { name: "Average Rating", color: pink }]);
    var reviews = '<div class="table-wrap"><table class="atable rtable"><thead><tr><th>Reviews</th><th>Version</th><th>Country/region</th><th>Name</th><th>Date</th></tr></thead><tbody>' +
      d.reviews.map(function (r) {
        return '<tr><td><div class="rev">' + starRowHTML(r.stars, "starrow--sm") + '<strong class="rev__title">' + esc(r.title) + '</strong>' +
          '<p class="rev__body muted">' + esc(r.body) + '</p><a class="linkbtn rev__reply">Reply</a></div></td>' +
          '<td>' + esc(r.ver) + '</td><td>' + esc(r.country) + '</td><td>' + esc(r.name) + '</td><td class="muted">' + esc(r.date) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    var geo = '<div class="table-wrap"><table class="atable"><thead><tr><th>Country</th><th class="num">Average Rating</th><th class="num">Total Ratings</th><th class="num">Total Review</th></tr></thead><tbody>' +
      d.geo.map(function (g) { return '<tr><td>' + esc(g.country) + '</td><td class="num">' + g.avg + '</td><td class="num">' + fmtComma(g.ratings) + '</td><td class="num">' + fmtComma(g.reviews) + '</td></tr>'; }).join("") + '</tbody></table></div>';
    return '<div class="apanel-grid">' + apanel("Ratings breakdown", breakdown) + apanel("Ratings over time", overtime) + '</div>' +
      apanel("Reviews", reviews) + apanel("Geographical spread", geo);
  }
  function avgArr(a) { return a.reduce(function (m, v) { return m + v; }, 0) / a.length; }
  function healthExtra(app, d) {
    var rnd = anaRng(Math.abs(hashStr(app.id + "|health")) || 1), days = d.hits.labels.length, i;
    var crashRateSeries = [], hangRateSeries = [];
    for (i = 0; i < days; i++) { crashRateSeries.push(+(0.012 + rnd() * 0.055).toFixed(3)); hangRateSeries.push(+(0.004 + rnd() * 0.13).toFixed(3)); }
    var GEO = [["Nigeria", 257, 37.03], ["United States", 81, 11.67], ["India", 59, 8.5], ["Tanzania", 59, 8.5], ["Unknown", 24, 3.46], ["Kenya", 21, 3.03], ["Zimbabwe", 16, 2.31], ["South Africa", 13, 1.87], ["United Kingdom", 12, 1.73], ["Ghana", 10, 1.44]];
    return {
      crashRateSeries: crashRateSeries, hangRateSeries: hangRateSeries,
      crashRate: +avgArr(crashRateSeries).toFixed(3), hangRate: +avgArr(hangRateSeries).toFixed(3),
      pkgVer: [{ ver: "2.1.1.0", hits: 692, pct: 99.71 }, { ver: "2.1.0.0", hits: 2, pct: 0.29 }],
      geo: GEO.map(function (g) { return { country: g[0], hits: g[1], pct: g[2] }; })
    };
  }
  function hitsTable(headA, rows) {
    return '<div class="table-wrap"><table class="atable"><thead><tr><th>' + headA + '</th><th class="num">Hits</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td class="num">' + fmtComma(r.hits) + ' <span class="muted">(' + r.pct.toFixed(2) + '%)</span></td></tr>'; }).join("") + '</tbody></table></div>';
  }
  function geoBars(rows) {
    var mx = rows.reduce(function (m, r) { return Math.max(m, r.hits); }, 1);
    return '<div class="geobars">' + rows.map(function (r) {
      return '<div class="geobar"><span class="geobar__label">' + esc(r.label) + '</span>' +
        '<span class="geobar__track"><span class="geobar__fill" style="width:' + (r.hits / mx * 100).toFixed(1) + '%"></span></span>' +
        '<span class="geobar__val">' + fmtComma(r.hits) + ' <span class="muted">(' + r.pct.toFixed(2) + '%)</span></span></div>';
    }).join("") + '</div>';
  }
  /* ===== Crash analytics: per-app crash overview (L1) + failure stack trace (L2) ===== */
  function caDays() { return anaRange === "7d" ? 7 : (anaRange === "custom" && anaCustom) ? anaCustom.days : 30; }
  function caView(app) {
    var d = anaData(app), full = d.hits, n = full.labels.length, days = Math.min(caDays(), n);
    function tail(a) { return a.slice(n - days); }
    var series = full.series.map(function (s) { return { name: s.name, color: s.color, values: tail(s.values) }; });
    function sum(a) { return a.reduce(function (m, v) { return m + v; }, 0); }
    var cr = sum(series[0].values), hg = sum(series[1].values), mem = sum(series[2].values);
    var ps = Math.max(0, n - 2 * days), pe = n - days;
    function psum(a) { return a.slice(ps, pe).reduce(function (m, v) { return m + v; }, 0) || 1; }
    function dp(c, p) { return +(((c - p) / p) * 100).toFixed(1); }
    return { days: days, labels: tail(full.labels), series: series, total: cr + hg + mem, crashes: cr, hangs: hg, mem: mem,
      dTotal: dp(cr + hg + mem, psum(full.series[0].values) + psum(full.series[1].values) + psum(full.series[2].values)),
      dCrash: dp(cr, psum(full.series[0].values)), dHang: dp(hg, psum(full.series[1].values)), dMem: dp(mem, psum(full.series[2].values)) };
  }
  function applyCustomRange(from, to) {
    if (!from || !to) { anaCustom = { days: 14, from: from, to: to }; return; }
    var a = new Date(from), b = new Date(to), days = Math.max(1, Math.round((b - a) / 864e5) + 1);
    var todayISO = new Date().toISOString().slice(0, 10);
    anaCustom = { days: Math.min(30, days), from: from, to: to, tooRecent: from === todayISO && to === todayISO };
  }
  function deltaPill(delta) {   // fewer failures (down) = good
    if (delta == null || !isFinite(delta) || delta === 0) return '<span class="delta delta--flat">\u2014</span>';
    var down = delta < 0;
    return '<span class="delta delta--' + (down ? "down" : "up") + '">' + (down ? "\u25BC" : "\u25B2") + " " + Math.abs(delta).toFixed(1) + '%</span>';
  }
  function countCard(label, val, sub, series, color, delta) {
    return '<div class="sumcard"><span class="sumcard__label">' + label + '</span>' +
      '<div class="sumcard__row"><strong class="sumcard__big">' + val + '</strong>' + deltaPill(delta) + '</div>' +
      '<span class="sumcard__sub muted">' + sub + '</span>' + (series ? spark(series, color) : "") + '</div>';
  }
  function anaFilterHTML() {
    var y = new Date(Date.now() - 864e5), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var refreshed = M[y.getMonth()] + " " + y.getDate() + ", " + y.getFullYear();
    var ranges = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["custom", "Custom range"]];
    var dateSel = '<fluent-dropdown id="anaRangeSel" appearance="outline" aria-label="Date range" placeholder="Date range"><fluent-listbox>' + ranges.map(function (r) { return '<fluent-option value="' + r[0] + '"' + (anaRange === r[0] ? " selected" : "") + '>' + r[1] + '</fluent-option>'; }).join("") + '</fluent-listbox></fluent-dropdown>';
    var custom = anaRange === "custom" ? '<span class="cacustom"><input type="date" class="cadate" id="caFrom"' + (anaCustom && anaCustom.from ? ' value="' + anaCustom.from + '"' : "") + '><span class="muted">to</span><input type="date" class="cadate" id="caTo"' + (anaCustom && anaCustom.to ? ' value="' + anaCustom.to + '"' : "") + '><fluent-button size="small" appearance="primary" data-ca-apply="1">Apply</fluent-button></span>' : "";
    var updated = '<span class="ca-updated" title="Crash data is aggregated from Windows with about 4 hours of data delay by design, so the most recent hours may still be filling in. Real-time data is not available.">' +
      '<iconify-icon icon="fluent:history-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Updated ' + refreshed + '</span>';
    var fc = filterCount(), filtersBtn = '<fluent-button id="anaFiltersBtn" appearance="outline" data-ca-filters="1"><iconify-icon slot="start" icon="fluent:filter-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon>Filters' + (fc ? '<fluent-counter-badge slot="end" count="' + fc + '" appearance="filled" color="brand" size="small"></fluent-counter-badge>' : "") + '</fluent-button>';
    return anaQuickFiltersHTML() + '<span class="anafb__end">' + updated + dateSel + custom + filtersBtn + '</span>';
  }
  // Quick filters surfaced outside the drawer. Only cross-tab dimensions (version, market,
  // device) so the toolbar stays identical across every analytics tab; tab-specific filters
  // (OS version, OS release, architecture) stay in the drawer. Single-select convenience.
  function anaQuickFiltersHTML() {
    var app = appById(analyticsAppId) || state.apps[0]; if (!app) return "";
    var appvers = anaData(app).versions.map(function (v) { return v.ver; });
    // The one surfaced quick filter is contextual — the dimension that leads THIS tab.
    // Version drives crash/usage/ratings triage; acquisition is about where installs come
    // from, so market leads there. Everything else stays in the Filters drawer.
    var byTab = {
      crashes: { key: "appver", all: "All versions", vals: appvers },
      usage: { key: "appver", all: "All versions", vals: appvers },
      ratings: { key: "appver", all: "All versions", vals: appvers },
      acquisition: { key: "market", all: "All markets", vals: null }
    };
    var defs = [byTab[anaTab] || byTab.crashes];
    return '<div class="anaqf-group">' + defs.map(function (q) {
      var cat = FILTER_CATS.filter(function (c) { return c.key === q.key; })[0];
      var vals = q.vals || (cat ? cat.values : []), sel = anaFilters[q.key] || [];
      var opts = '<fluent-option value="__all"' + (sel.length === 0 ? " selected" : "") + '>' + esc(q.all) + '</fluent-option>';
      if (sel.length > 1) opts += '<fluent-option value="__multi" selected>' + sel.length + ' selected</fluent-option>';
      opts += vals.map(function (v) { return '<fluent-option value="' + esc(v) + '"' + (sel.length === 1 && sel[0] === v ? " selected" : "") + '>' + esc(v) + '</fluent-option>'; }).join("");
      return '<fluent-dropdown class="anaqf" data-qf="' + q.key + '" appearance="outline" aria-label="' + esc(cat ? cat.label : q.key) + '"><fluent-listbox>' + opts + '</fluent-listbox></fluent-dropdown>';
    }).join("") + '</div>';
  }
  function failLabel(f) {
    if (f.fn && f.fn !== "!Unknown") return f.fn;
    var m = f.name.match(/^(.*?)_(?:c[0-9a-fA-F]{7}|[0-9a-fA-F]{8})_/);
    return m ? m[1] : f.name;
  }
  var aiDismissed = {};   // per-app: user dismissed the AI insight for this session
  function aiInsightHTML(app) {
    if (aiDismissed[app.id]) return "";
    var d = anaData(app);
    var sorted = d.failures.slice().sort(function (a, b) { return b.hits - a.hits; });
    var neu = sorted.filter(function (f) { return f.isNew; })[0], t = neu || sorted[0];
    if (!t) return "";
    var lbl = esc(failLabel(t)), ver = esc(t.ver), hits = fmtCompact(t.hits), dev = fmtCompact(t.devices);
    var s = neu
      ? "<strong>" + lbl + "</strong> in <strong>" + ver + "</strong> is a new failure this release \u2014 already <strong>" + hits + "</strong> hits across <strong>" + dev + "</strong> devices and climbing fast. Investigate before it spreads."
      : "Your biggest failure is <strong>" + lbl + "</strong> in <strong>" + ver + "</strong> \u2014 <strong>" + hits + "</strong> hits across <strong>" + dev + "</strong> devices. Fixing it clears the most crashes.";
    return '<div class="ai-insight"><span class="ai-insight__badge"><iconify-icon icon="fluent:sparkle-16-filled" width="15" height="15" aria-hidden="true"></iconify-icon>AI insight</span>' +
      '<p class="ai-insight__text">' + s + '</p>' +
      '<fluent-button appearance="primary" size="small" class="ai-insight__cta" data-failure="' + t.id + '"><iconify-icon slot="start" icon="fluent:bug-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon>Investigate failure</fluent-button>' +
      '<button class="ai-insight__x" data-ai-dismiss="1" aria-label="Dismiss insight" title="Dismiss"><iconify-icon icon="fluent:dismiss-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon></button></div>';
  }
  function symPill(st) { var m = SYM_STATES[st] || SYM_STATES.notuploaded, cm = { ok: "success", info: "brand", idle: "warning", warn: "danger" }; return '<fluent-badge appearance="outline" color="' + (cm[m.cls] || "subtle") + '">' + m.label + '</fluent-badge>'; }
  function ftypePill(t) { return '<span class="ftype-txt">' + esc(t) + '</span>'; }
  function zeroStateHTML(app) {
    var msix = isMsix(app);
    var nudge = msix
      ? '<div class="ca-zero__nudge"><span class="ca-zero__tag"><iconify-icon icon="fluent:box-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Packaged app</span>' +
        '<h3>Stack traces resolve automatically</h3>' +
        '<p><strong>' + esc(app.name) + '</strong> ships as an MSIX package, so its symbols travel inside the package \u2014 there\u2019s nothing to upload. Every crash and hang will show a fully resolved stack trace with function names, files and line numbers from the very first report.</p></div>'
      : '<div class="ca-zero__nudge"><span class="ca-zero__tag"><iconify-icon icon="fluent:sparkle-16-filled" width="14" height="14" aria-hidden="true"></iconify-icon>Do this first</span>' +
        '<h3>Upload your symbols before the first crash</h3>' +
        '<p>Symbols are the heart of crash analytics \u2014 they turn raw memory offsets into readable stack traces with function names, files and line numbers. But they only resolve crashes that happen <strong>after</strong> they\u2019re uploaded; crashes that already happened stay unreadable. Upload <strong>' + esc(app.name) + '</strong>\u2019s symbol package (.zip) now so your very first crash is actionable from day one.</p>' +
        '<div class="ca-zero__cta"><fluent-button appearance="primary" data-ca-upload="1"><iconify-icon slot="start" icon="fluent:arrow-upload-16-filled" width="16" height="16" aria-hidden="true"></iconify-icon>Upload symbols</fluent-button>' +
        '<fluent-link href="#" data-noop="1">What should I upload? \u2192</fluent-link></div></div>';
    return '<div class="ca-zero"><div class="ca-zero__hero"><iconify-icon icon="fluent:shield-checkmark-24-regular" width="40" height="40" aria-hidden="true"></iconify-icon>' +
      '<h2>No crashes reported yet for ' + esc(app.name) + '</h2>' +
      '<p class="muted">Analytics turn on once your app is installed on about <strong>100 devices</strong>. After that, crashes and hangs from Windows Error Reporting show up here \u2014 within about <strong>4 hours</strong>.</p>' +
      '<p class="ca-zero__tip muted"><iconify-icon icon="fluent:info-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Set your app\u2019s file and product version metadata so failures group correctly \u2014 builds with missing metadata are reported under \u201cUnknown\u201d.</p></div>' +
      nudge + '</div>';
  }
  function latencyZeroHTML() {
    return '<div class="ca-zero"><div class="ca-zero__hero"><iconify-icon icon="fluent:clock-24-regular" width="40" height="40" aria-hidden="true"></iconify-icon>' +
      '<h2>No data for this window yet</h2>' +
      '<p class="muted">Crash data lands with about 4 hours of delay, so the most recent hours are still being collected. Check back shortly or pick a range that ends earlier to see results.</p></div></div>';
  }
  function demoSwitchHTML() {
    var states = [["live", "Live data"], ["newapp", "New app (no data)"]];
    return '<div class="demoswitch" role="group" aria-label="Demo state"><span class="demoswitch__label"><iconify-icon icon="fluent:beaker-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Demo</span>' +
      states.map(function (s) { return '<button class="demoswitch__b' + (anaDemoState === s[0] ? " is-on" : "") + '" data-demostate="' + s[0] + '">' + s[1] + '</button>'; }).join("") + '</div>';
  }
  function crashTab(app) {
    var d = anaData(app);
    if (anaFailure) return failureView(app, d);
    if (anaDemoState === "newapp") return zeroStateHTML(app);
    if (anaRange === "custom" && anaCustom && anaCustom.tooRecent) return latencyZeroHTML();
    var v = caView(app), sub = anaRange === "7d" ? "Last 7 days" : anaRange === "custom" ? "Custom range" : "Last 30 days", h = healthExtra(app, d);
    var totalSeries = v.series[0].values.map(function (x, i) { return x + v.series[1].values[i] + v.series[2].values[i]; });
    var cards = '<div class="sumrow sumrow--4">' +
      countCard("Total failures", fmtCompact(v.total), sub, totalSeries, "var(--brand)", v.dTotal) +
      countCard("Crashes", fmtCompact(v.crashes), sub, v.series[0].values, "var(--brand)", v.dCrash) +
      countCard("Hangs", fmtCompact(v.hangs), sub, v.series[1].values, "var(--magenta)", v.dHang) +
      countCard("Memory failures", fmtCompact(v.mem), sub, v.series[2].values, "var(--purple)", v.dMem) + '</div>';
    var msix = isMsix(app);
    return aiInsightHTML(app) + cards + (msix ? "" : symbolsPanel(app)) +
      rootCausesPanel(app) +
      failuresPanel(app, d) +
      apanel("Failures over time", chartLine({ series: v.series, labels: v.labels, area: true }) + chartLegend(v.series), "Crashes, hangs and memory failures across all your users") +
      apanel("Failures by version", chartBars({ bars: d.dist }), "Failures grouped by the app version they occurred on") +
      apanel("Geographical failure hits", geoBars(h.geo.slice(0, 8).map(function (r) { return { label: r.country, hits: r.hits, pct: r.pct }; })), "Top regions by failure hits");
  }
  function symbolsPanel(app) {
    var d = anaData(app), hp = d.symbolHealth, hcls = hp >= 80 ? "ok" : hp >= 50 ? "warn" : "bad";
    var rn = d.versions.filter(function (v) { return v.sym === "resolved"; }).length, nv = d.versions.length;
    var actionV = d.versions.filter(function (v) { return v.sym === "action"; })[0];
    var unreadable = d.failures.filter(function (f) { return !f.resolved; }).reduce(function (m, f) { return m + f.hits; }, 0);
    var detail = (rn === nv)
      ? "All " + nv + " versions resolved \u00b7 stacks resolving normally"
      : rn + " of " + nv + " versions resolved \u00b7 <strong>" + fmtCompact(unreadable) + "</strong> crashes can\u2019t show stack traces";
    if (actionV) detail += " \u00b7 <span class=\"sympanel__warn\">action needed on " + esc(actionV.ver) + "</span>";
    // Accordion: collapsed by default = coverage health at a glance (any "action needed" version
    // is still surfaced in the header); expand to manage symbols in place, on demand.
    return '<section class="apanel sympanel" id="ca-symsec">' +
      '<details class="symacc">' +
      '<summary class="symacc__sum">' +
        '<span class="ca-symring ca-symring--' + hcls + '" style="--p:' + hp + '"><span>' + hp + '%</span></span>' +
        '<span class="symacc__txt"><span class="symacc__label">Symbols coverage</span><span class="symacc__detail">' + detail + '</span></span>' +
        '<span class="symacc__actions"><fluent-button appearance="outline" size="small" data-sym-history="1"><iconify-icon slot="start" icon="fluent:history-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon>History</fluent-button>' +
        '<fluent-button appearance="primary" size="small" class="ca-uploadbtn" data-ca-upload="1"><iconify-icon slot="start" icon="fluent:arrow-upload-16-filled" width="16" height="16" aria-hidden="true"></iconify-icon>Upload symbols</fluent-button></span>' +
        '<iconify-icon class="symacc__chev" icon="fluent:chevron-down-16-regular" width="18" height="18" aria-hidden="true"></iconify-icon>' +
      '</summary>' +
      '<div class="symacc__body">' +
        '<p class="apanel__sub muted symacc__hint">Symbols are matched per app version. Uploading resolves stack traces for <strong>future</strong> crashes on that build \u2014 occurrences that already happened stay unresolved. Processing can take up to 24 hours \u2014 we\u2019ll email you when a version resolves or needs attention.</p>' +
        '<div id="symTableHost">' + symbolsTable(app) + '</div>' +
      '</div>' +
      '</details></section>';
  }
  function failuresPanel(app, d) {
    return '<section class="apanel" id="ca-failsec"><header class="apanel__head"><h3>Failures</h3>' +
      '<iconify-icon class="apanel__i" icon="fluent:info-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon></header>' +
      '<p class="apanel__sub muted">Grouped by failure signature. Sorted by impact \u2014 select one to see its stack trace.</p>' +
      '<div class="failctl"><fluent-text-input id="failSearch" appearance="outline" class="failsearch" placeholder="Search failures\u2026" value="' + esc(anaSearch) + '"><iconify-icon slot="start" icon="fluent:search-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon></fluent-text-input>' + failSegHTML() + '</div>' +
      '<div id="failTableHost">' + failTableInner(app) + '</div></section>';
  }
  function failSegHTML() {
    var types = [["all", "All types"], ["Crash", "Crashes"], ["Hang", "Hangs"], ["Memory", "Memory failures"]];
    return '<fluent-dropdown id="anaTypeSel" class="failtypesel" appearance="outline" aria-label="Filter by failure type"><fluent-listbox>' + types.map(function (t) {
      return '<fluent-option value="' + t[0] + '"' + (anaType === t[0] ? " selected" : "") + '>' + t[1] + '</fluent-option>';
    }).join("") + '</fluent-listbox></fluent-dropdown>';
  }
  function pagerHTML(pg, pages, attr, total, noun) {
    if (pages <= 1) return "";
    return '<div class="apager">' +
      '<button class="apager__b" ' + attr + '="' + (pg - 1) + '"' + (pg <= 0 ? " disabled" : "") + ' aria-label="Previous page"><iconify-icon icon="fluent:chevron-left-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon></button>' +
      '<span class="apager__status">Page ' + (pg + 1) + ' of ' + pages + ' \u00b7 ' + total + ' ' + noun + '</span>' +
      '<button class="apager__b" ' + attr + '="' + (pg + 1) + '"' + (pg >= pages - 1 ? " disabled" : "") + ' aria-label="Next page"><iconify-icon icon="fluent:chevron-right-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon></button></div>';
  }
  function failTableInner(app) {
    var d = anaData(app), msix = isMsix(app), list = d.failures.slice();
    var vf = anaFilters.appver; if (vf && vf.length) list = list.filter(function (f) { return vf.indexOf(f.ver) >= 0; });
    if (anaType !== "all") list = list.filter(function (f) { return f.type === anaType; });
    if (anaCause) list = list.filter(function (f) { return causeCat(f).key === anaCause; });
    if (anaSearch) { var q = anaSearch.toLowerCase(); list = list.filter(function (f) { return f.name.toLowerCase().indexOf(q) >= 0 || f.ver.toLowerCase().indexOf(q) >= 0; }); }
    var key = anaSort.key, dir = anaSort.dir === "asc" ? 1 : -1;
    list.sort(function (a, b) { return (a[key] - b[key]) * dir; });
    var per = 6, pages = Math.max(1, Math.ceil(list.length / per)), pg = Math.max(0, Math.min(anaPage, pages - 1));
    function sortTh(label, k) { var on = anaSort.key === k; return '<th class="num th-sort" data-anasort="' + k + '" role="button" tabindex="0" aria-label="Sort by ' + label + '">' + label + (on ? ' <span class="th-arrow">' + (anaSort.dir === "asc" ? "\u25B2" : "\u25BC") + '</span>' : "") + '</th>'; }
    var rows = list.slice(pg * per, pg * per + per).map(function (f) {
      return '<tr class="failrow" data-failure="' + f.id + '" tabindex="0" role="button" aria-label="View ' + esc(f.name) + '">' +
        '<td><span class="faillink">' + esc(f.name) + '</span>' + (f.isNew ? '<fluent-badge class="newbadge" appearance="outline" color="success">New</fluent-badge>' : "") + '</td>' +
        '<td>' + ftypePill(f.type) + '</td><td><span class="mono">' + esc(f.ver) + '</span></td>' +
        (msix ? "" : '<td>' + (f.resolved ? '<fluent-badge appearance="outline" color="success">Resolved</fluent-badge>' : '<fluent-badge class="symjump" data-sym-jump="' + esc(f.ver) + '" appearance="outline" color="warning" title="Manage symbols for ' + esc(f.ver) + '">Unresolved</fluent-badge>') + '</td>') +
        '<td class="num" title="' + fmtComma(f.hits) + ' hits">' + fmtCompact(f.hits) + '</td><td class="num" title="' + fmtComma(f.devices) + ' devices">' + fmtCompact(f.devices) + '</td></tr>';
    }).join("");
    if (!list.length) rows = '<tr><td colspan="' + (msix ? 5 : 6) + '" class="cellspan">No failures match your search or filters.</td></tr>';
    var causeChip = anaCause ? '<div class="failcausechip"><iconify-icon icon="fluent:filter-16-filled" width="14" height="14" aria-hidden="true"></iconify-icon><span>Category: <strong>' + esc(causeLabelByKey(app, anaCause)) + '</strong></span><button class="failcausechip__x" data-cause-clear="1" aria-label="Clear category filter" title="Clear category filter"><iconify-icon icon="fluent:dismiss-12-regular" width="12" height="12" aria-hidden="true"></iconify-icon></button></div>' : "";
    return causeChip + '<div class="table-wrap"><table class="atable atable--fail"><thead><tr><th>Failure</th><th>Type</th><th>Version</th>' + (msix ? "" : '<th>Symbols</th>') + sortTh("Hits", "hits") + sortTh("Devices", "devices") + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      pagerHTML(pg, pages, "data-anapage", list.length, "failures");
  }
  function renderFailTableHost() { var h = $("failTableHost"); if (h) h.innerHTML = failTableInner(appById(analyticsAppId) || state.apps[0]); }
  function renderSymTableHost() { var h = $("symTableHost"); if (h) h.innerHTML = symbolsTable(appById(analyticsAppId) || state.apps[0]); }
  function cmpVer(a, b) {
    var pa = String(a).split("."), pb = String(b).split("."), n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) { var na = parseInt(pa[i] || "0", 10), nb = parseInt(pb[i] || "0", 10); if (na !== nb) return na - nb; }
    return 0;
  }
  function symbolsTable(app) {
    var d = anaData(app), list = d.versions.slice(), dir = symSort.dir === "asc" ? 1 : -1;
    var symRank = { action: 3, notuploaded: 2, processing: 1, resolved: 0 };
    if (symSort.key === "ver") list.sort(function (a, b) { return cmpVer(a.ver, b.ver) * dir; });
    else if (symSort.key === "sym") list.sort(function (a, b) { return ((symRank[a.sym] || 0) - (symRank[b.sym] || 0)) * dir || cmpVer(b.ver, a.ver); });
    else list.sort(function (a, b) { return (a.failures - b.failures) * dir; });
    function symTh(label, k, num) { var on = symSort.key === k; return '<th class="' + (num ? "num " : "") + 'th-sort" data-symsort="' + k + '" role="button" tabindex="0" aria-label="Sort by ' + label + '">' + label + (on ? ' <span class="th-arrow">' + (symSort.dir === "asc" ? "\u25B2" : "\u25BC") + '</span>' : "") + '</th>'; }
    var rows = list.map(function (v) {
      var act = v.sym === "action" ? '<fluent-link data-sym-details="' + esc(v.ver) + '">View details</fluent-link>'
        : v.sym === "processing" ? '<span class="muted">Validating\u2026</span>'
        : v.sym === "notuploaded" ? '<fluent-link data-sym-upload="' + esc(v.ver) + '">Upload</fluent-link>'
        : '<fluent-link data-sym-upload="' + esc(v.ver) + '">Re-upload</fluent-link>';
      return '<tr data-ver="' + esc(v.ver) + '"><td><span class="mono">' + esc(v.ver) + '</span></td><td class="num">' + fmtComma(v.failures) + '</td><td>' + symPill(v.sym) + '</td><td class="atable__act">' + act + '</td></tr>';
    }).join("");
    return '<div class="table-wrap"><table class="atable atable--sym"><thead><tr>' + symTh("App version", "ver") + symTh("Failures", "failures", true) + symTh("Symbol status", "sym") + '<th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function symbolHistoryTable(app) {
    var d = anaData(app);
    if (!d.history.length) return '<div class="empty empty--sm"><strong>No uploads yet</strong><p class="muted">Upload symbols to start building your audit trail.</p></div>';
    var rows = d.history.map(function (h) {
      return '<tr><td><span class="symfile-cell"><iconify-icon icon="fluent:folder-zip-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon><span class="mono">' + esc(h.file) + '</span></span></td>' +
        '<td><span class="mono">' + esc(h.ver) + '</span></td><td>' + symPill(h.status) + '</td>' +
        '<td><div class="histby">' + esc(h.by) + '</div><div class="histby__date muted">' + esc(h.date) + '</div></td>' +
        '<td class="atable__act"><fluent-link data-dl-sym="' + h.id + '"><iconify-icon icon="fluent:arrow-download-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon> Download</fluent-link></td></tr>';
    }).join("");
    return '<div class="table-wrap"><table class="atable"><thead><tr><th>Symbol package</th><th>Version</th><th>Status</th><th>Uploaded</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function srcFile(fn) { var b = (fn.split("::")[0] || fn).toLowerCase().replace(/[^a-z]/g, ""); return (b || "module") + ".cpp"; }
  function stackFrames(app, f) {
    var d = anaData(app);
    var osTail = ["USER32!DispatchMessageW + 0x2d1", "KERNEL32!BaseThreadInitThunk + 0x14", "ntdll!RtlUserThreadStart + 0x21"];
    if (f.resolved) return [
      d.base + "!" + f.fn + "(RenderContext *)  [" + srcFile(f.fn) + ":" + (300 + (Math.abs(hashStr(f.id)) % 500)) + "]",
      d.base + "!Compositor::Commit(void)  [compositor.cpp:158]",
      d.base + "!ui::View::OnPaint(PaintArgs &)  [view.cpp:1032]"
    ].concat(osTail);
    var modOff = function (seed) { var r = anaRng(seed || 1); var v = 0x120000 + ((r() * 0xE00000) | 0); return "0x" + ("00000000" + v.toString(16)).slice(-8); };
    return [d.base + ".exe + " + modOff(Math.abs(hashStr(f.id)) || 1), d.base + ".exe + " + modOff((Math.abs(hashStr(f.id)) + 7) || 1)].concat(osTail);
  }
  function frameParts(fr, base) {
    var s = String(fr).trim(), loc = null;
    var lm = s.match(/\s*\[([^\]]+)\]\s*$/);
    if (lm) { loc = lm[1].trim(); s = s.slice(0, lm.index).trim(); }
    var mod = s.split(/[!\s]/)[0].replace(/\.(exe|dll)$/i, "");
    return { code: s, loc: loc, module: mod, app: !!base && mod.toLowerCase() === String(base).toLowerCase() };
  }
  function callerFn(code) { var s = String(code).split("!")[1] || String(code); return s.replace(/\s*\(.*\)\s*$/, ""); }
  function topShare(list, key) {
    var c = {}, n = list.length || 1, best = "", bc = 0;
    list.forEach(function (r) { var v = r[key]; c[v] = (c[v] || 0) + 1; if (c[v] > bc) { bc = c[v]; best = v; } });
    return { label: best, pct: Math.round(bc / n * 100) };
  }
  function crashCause(f) {
    var c = (f.code || "").toUpperCase(), t = f.type;
    if (t === "Hang") return { name: "an unresponsive UI thread \u2014 work is blocking the message pump", fix: "Move the long-running call off the UI thread (async/await or a background task) and add cancellation so the UI stays responsive." };
    if (c.indexOf("C00000FD") >= 0) return { name: "a stack overflow \u2014 unbounded recursion or an oversized stack buffer", fix: "Add a base-case/depth guard to the recursive path and move large buffers to the heap." };
    if (c.indexOf("C0000409") >= 0) return { name: "a fail-fast abort \u2014 the CRT detected stack/buffer corruption and terminated the process", fix: "Track down the out-of-bounds write feeding the corrupted buffer near the crash site; build with /GS and run under Application Verifier to catch it." };
    if (c.indexOf("C0000374") >= 0) return { name: "heap corruption \u2014 a bad write damaged heap metadata", fix: "Audit buffer sizes and use-after-free around the failing allocation; PageHeap will halt at the offending write." };
    if (t === "Memory" || c.indexOf("C06D") >= 0) return { name: "heap corruption or an invalid free near the failing allocation", fix: "Run the build under Application Verifier + PageHeap to catch the offending write, then audit buffer sizes and object ownership around the crash site." };
    if (c.indexOf("C0000005") >= 0) return { name: "an access violation \u2014 a null or already-freed pointer was dereferenced", fix: "Null-check the pointer before use and confirm the object outlives this call; a use-after-free one frame up is the usual culprit." };
    if (c.indexOf("80000003") >= 0) return { name: "a debug breakpoint (int 3) \u2014 a shipped assert or __debugbreak fired, usually on an error path", fix: "Find the assertion/__debugbreak on the failing path, handle the error condition gracefully, and strip debug breaks from release builds." };
    return { name: "an unhandled exception", fix: "Wrap the failing operation in structured exception handling and validate its inputs before the call." };
  }
  // Compact cause CATEGORY for grouping (parallels crashCause but returns a short bucket label + icon).
  function causeCat(f) {
    var c = (f.code || "").toUpperCase(), t = f.type;
    if (t === "Hang") return { key: "hang", label: "Unresponsive UI (hang)", icon: "fluent:hourglass-16-regular" };
    if (c.indexOf("C00000FD") >= 0) return { key: "stack", label: "Stack overflow", icon: "fluent:arrow-repeat-all-16-regular" };
    if (c.indexOf("C0000409") >= 0) return { key: "failfast", label: "Fail-fast (buffer overrun)", icon: "fluent:shield-error-16-regular" };
    if (c.indexOf("C0000374") >= 0) return { key: "heap", label: "Heap corruption", icon: "fluent:memory-16-regular" };
    if (t === "Memory" || c.indexOf("C06D") >= 0) return { key: "memory", label: "Memory / heap failure", icon: "fluent:memory-16-regular" };
    if (c.indexOf("C0000005") >= 0) return { key: "av", label: "Access violation (null / use-after-free)", icon: "fluent:target-16-regular" };
    if (c.indexOf("80000003") >= 0) return { key: "break", label: "Debug breakpoint (assert)", icon: "fluent:bug-16-regular" };
    return { key: "other", label: "Unhandled exception", icon: "fluent:warning-16-regular" };
  }
  // Resolve a cause key back to its label (single source of truth = causeCat over real failures).
  function causeLabelByKey(app, key) {
    var d = anaData(app);
    for (var i = 0; i < d.failures.length; i++) { var c = causeCat(d.failures[i]); if (c.key === key) return c.label; }
    return key;
  }
  // Aggregate failure buckets into cause groups (share of total hits, signatures, top version).
  function topRootCauses(d) {
    var groups = {}, order = [], total = 0;
    d.failures.forEach(function (f) {
      total += f.hits;
      var cat = causeCat(f), g = groups[cat.key];
      if (!g) { g = groups[cat.key] = { key: cat.key, label: cat.label, icon: cat.icon, hits: 0, devices: 0, sigs: 0, resolved: 0, vers: {}, top: null }; order.push(g); }
      g.hits += f.hits; g.devices += f.devices; g.sigs++; if (f.resolved) g.resolved++;
      g.vers[f.ver] = (g.vers[f.ver] || 0) + f.hits;
      if (!g.top || f.hits > g.top.hits) g.top = f;
    });
    order.forEach(function (g) {
      g.pct = total ? +(g.hits / total * 100).toFixed(1) : 0;
      g.unresolved = g.sigs - g.resolved;
      var bv = null, bh = -1; for (var v in g.vers) { if (g.vers.hasOwnProperty(v) && g.vers[v] > bh) { bh = g.vers[v]; bv = v; } }
      g.topVer = bv;
    });
    order.sort(function (a, b) { return b.hits - a.hits; });
    return { list: order, total: total };
  }
  // "Top root causes" summary panel (app-level roll-up above the per-signature failures table).
  function rootCausesPanel(app) {
    var d = anaData(app), rc = topRootCauses(d);
    if (!rc.list.length) return "";
    var msix = isMsix(app), top = rc.list[0];
    var lead = '<p class="rootcause__lead"><strong>' + top.pct + '%</strong> of failure hits fall into <strong>' + esc(top.label) + '</strong>' +
      (top.topVer ? ' \u2014 most on <span class="mono">' + esc(top.topVer) + '</span>' : "") + '.</p>';
    var rows = rc.list.slice(0, 5).map(function (g) {
      var meta = fmtCompact(g.hits) + ' hits \u00b7 ' + g.sigs + ' signature' + (g.sigs > 1 ? "s" : "") + (g.topVer ? ' \u00b7 top in ' + esc(g.topVer) : "");
      var unres = (!msix && g.unresolved > 0) ? ' \u00b7 <span class="rootcause__unres" title="' + g.unresolved + ' signature' + (g.unresolved > 1 ? "s" : "") + (g.unresolved === 1 ? ' needs' : ' need') + ' symbols to name the exact frame">' + g.unresolved + (g.unresolved === 1 ? ' needs symbols' : ' need symbols') + '</span>' : "";
      return '<div class="rootcause" data-cause="' + esc(g.key) + '" role="button" tabindex="0" aria-label="Filter failures to ' + esc(g.label) + '">' +
        '<span class="rootcause__ico"><iconify-icon icon="' + g.icon + '" width="17" height="17" aria-hidden="true"></iconify-icon></span>' +
        '<span class="rootcause__main">' +
          '<span class="rootcause__row1"><span class="rootcause__label">' + esc(g.label) + '</span><span class="rootcause__pct">' + g.pct + '%</span></span>' +
          '<span class="rootcause__bar"><span class="rootcause__fill" style="width:' + Math.max(2, g.pct) + '%"></span></span>' +
          '<span class="rootcause__meta muted">' + meta + unres + '</span>' +
        '</span>' +
        '<iconify-icon class="rootcause__chev" icon="fluent:filter-16-regular" width="16" height="16" aria-hidden="true"></iconify-icon>' +
      '</div>';
    }).join("");
    return apanel("Top failure categories", lead + '<div class="rootcause-list">' + rows + '</div>', "Grouped by fault type from the exception code \u2014 select a category to filter the failures list below");
  }
  function crashInsightHTML(app, f, parts, env, occ) {
    var cause = crashCause(f), crash = parts[0] || { loc: "" }, caller = parts[1];
    var where = (crash && crash.loc) ? '<span class="mono">' + esc(crash.loc) + '</span>' : '<span class="mono">' + esc(f.fn) + '</span>';
    var callerTxt = caller ? ' It runs from <span class="mono">' + esc(callerFn(caller.code)) + '</span>' + (caller.loc ? ' (<span class="mono">' + esc(caller.loc) + '</span>)' : "") + ', so the bad state is often set there.' : "";
    var envTxt = env ? ' Reproduce on <strong>' + esc(env.os.label) + '</strong> (' + env.os.pct + '% of hits)' + (env.dev.pct >= 40 ? ', mostly on <strong>' + esc(env.dev.label) + '</strong> devices' : "") + '.' : "";
    var occTxt = occ ? '<p><strong>This instance:</strong> ' + esc(occ.dev) + ' \u00b7 ' + esc(occ.model) + ' on <span class="mono">' + esc(occ.os) + '</span> \u00b7 ' + esc(occ.date) + '.</p>' : "";
    return '<div class="crashai__head"><span class="crashai__badge"><iconify-icon icon="fluent:sparkle-16-filled" width="14" height="14" aria-hidden="true"></iconify-icon>AI analysis</span><span class="crashai__conf muted">Generated from the stack, exception code &amp; telemetry</span></div>' +
      occTxt +
      '<p><strong>Likely cause:</strong> ' + cause.name + ', consistent with <span class="mono">' + esc(f.code) + '</span> (' + esc(f.type) + ').</p>' +
      '<p><strong>Where to look:</strong> start at ' + where + ', the crash site in <span class="mono">' + esc(f.fn) + '</span>.' + callerTxt + '</p>' +
      '<p><strong>Suggested fix:</strong> ' + cause.fix + envTxt + '</p>' +
      '<p class="crashai__note muted"><iconify-icon icon="fluent:info-16-regular" width="13" height="13" aria-hidden="true"></iconify-icon>AI-generated suggestion \u2014 verify against your source before shipping.</p>';
  }
  function stackBody(app, f) {
    var frames = stackFrames(app, f), base = anaData(app).base;
    var parts = frames.map(function (fr) { return frameParts(fr, base); });
    var frameRow = function (i, p) {
      var loc = p.loc ? '<button class="stk__loc mono" data-copy-loc="' + esc(p.loc) + '" title="Copy ' + esc(p.loc) + '">' + esc(p.loc) + '<iconify-icon icon="fluent:copy-16-regular" width="13" height="13" aria-hidden="true"></iconify-icon></button>' : "";
      return '<div class="stk__frame stk__frame--' + (p.app ? "app" : "sys") + (i === 0 ? " is-crash" : "") + '"><span class="stk__idx">' + i + '</span><span class="stk__fn mono">' + esc(p.code) + '</span>' + loc + '</div>';
    };
    var appRows = "", sysRows = "", sysN = 0;
    parts.forEach(function (p, i) { if (p.app) appRows += frameRow(i, p); else { sysRows += frameRow(i, p); sysN++; } });
    var sysBlock = sysN ? '<details class="stk__sys"><summary class="stk__syssum"><iconify-icon class="stk__syschev" icon="fluent:chevron-right-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon>' + sysN + ' system frame' + (sysN > 1 ? "s" : "") + ' \u00b7 Windows runtime, not your code</summary><div>' + sysRows + '</div></details>' : "";
    return { html: '<div class="stk__body">' + appRows + sysBlock + '</div>', parts: parts };
  }
  function stackTSV(app, f) {
    var frames = stackFrames(app, f), base = anaData(app).base, lines = ["Frame\tImage\tFunction\tLocation"];
    frames.forEach(function (fr, i) {
      var p = frameParts(fr, base), image = p.module, fn = "", locv = p.loc || "", bang = p.code.indexOf("!");
      if (bang >= 0) { fn = p.code.slice(bang + 1); var op = fn.indexOf(" + 0x"); if (op >= 0) { if (!locv) locv = fn.slice(op + 3); fn = fn.slice(0, op); } }
      else { var pl = p.code.indexOf(" + "); if (pl >= 0 && !locv) locv = p.code.slice(pl + 3); }
      lines.push(i + "\t" + image + "\t" + fn + "\t" + locv);
    });
    return lines.join("\n");
  }
  function stackTraceHTML(app, f, det) {
    var msix = isMsix(app);
    var env = det && det.log ? { os: topShare(det.log, "os"), dev: topShare(det.log, "dev") } : null;
    var envHTML = env ? '<div class="stk__env"><iconify-icon icon="fluent:target-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Most affected: <strong>' + esc(env.os.label) + '</strong> (' + env.os.pct + '%) \u00b7 <strong>' + esc(env.dev.label) + '</strong> devices (' + env.dev.pct + '%)</div>' : "";
    var sb = stackBody(app, f), bodyHTML = sb.html, parts = sb.parts;
    var ctx = envHTML + '<p class="stk__rep muted">Representative stack for this failure \u2014 every occurrence shares this signature. Select a row in the failure log below to see that occurrence\u2019s stack.</p>';
    if (f.resolved) {
      return '<div class="stk stk--resolved"><div class="stk__head"><fluent-badge appearance="outline" color="success">' + (msix ? "Full stack trace" : "Symbols resolved") + '</fluent-badge>' +
        '<span class="muted stk__excn">' + esc(f.code) + ' \u00b7 ' + esc(f.type) + '</span>' +
        '<span class="stk__actions"><fluent-button appearance="outline" size="small" data-crashai="' + f.id + '"><iconify-icon slot="start" icon="fluent:sparkle-16-filled" width="14" height="14" aria-hidden="true"></iconify-icon>Explain this crash</fluent-button>' +
        '<fluent-button appearance="outline" size="small" data-copy-stack="' + f.id + '"><iconify-icon slot="start" icon="fluent:copy-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Copy</fluent-button>' +
        '<fluent-button appearance="outline" size="small" data-dl-stack="' + f.id + '"><iconify-icon slot="start" icon="fluent:arrow-download-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Download stack</fluent-button></span></div>' +
        ctx + bodyHTML +
        '<p class="stk__hint muted">Frame 0 is the crash site \u2014 <span class="mono">' + esc(f.fn) + '</span>. Select a <span class="mono">file:line</span> to copy it and jump to your source.</p>' +
        '<div class="crashai" id="crashai-' + f.id + '" hidden>' + crashInsightHTML(app, f, parts, env) + '</div></div>';
    }
    return '<div class="stk stk--unresolved"><div class="stk__head"><fluent-badge appearance="outline" color="warning">Symbols not available</fluent-badge>' +
      '<span class="muted stk__excn">' + esc(f.code) + ' \u00b7 ' + esc(f.type) + '</span>' +
      '<span class="stk__actions"><fluent-button appearance="outline" size="small" data-sym-manage="' + esc(f.ver) + '"><iconify-icon slot="start" icon="fluent:folder-zip-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Manage symbols</fluent-button>' +
      '<fluent-button appearance="outline" size="small" data-copy-stack="' + f.id + '"><iconify-icon slot="start" icon="fluent:copy-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Copy</fluent-button>' +
      '<fluent-button appearance="outline" size="small" data-dl-stack="' + f.id + '"><iconify-icon slot="start" icon="fluent:arrow-download-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Download stack</fluent-button></span></div>' + ctx + bodyHTML +
      '<p class="stk__hint muted">No symbols for <strong>' + esc(f.ver) + '</strong>, so these frames show as raw offsets \u2014 Windows frames resolve automatically. Uploading symbols can\u2019t fix this crash or any that already happened \u2014 it only names <strong>future</strong> ones. <button class="stk__link" data-sym-manage="' + esc(f.ver) + '">Manage symbols for ' + esc(f.ver) + '</button> to resolve future reports.</p></div>';
  }
  function occStackHTML(app, f, occ) {
    var badge = isMsix(app) ? '<fluent-badge appearance="outline" color="success">Full stack trace</fluent-badge>'
      : f.resolved ? '<fluent-badge appearance="outline" color="success">Symbols resolved</fluent-badge>' : '<fluent-badge appearance="outline" color="warning">Symbols not available</fluent-badge>';
    var sb = stackBody(app, f);
    var det = failureDetail(app, f);
    var env = det && det.log ? { os: topShare(det.log, "os"), dev: topShare(det.log, "dev") } : null;
    var aiBtn = f.resolved ? '<fluent-button appearance="outline" size="small" data-crashai-occ="' + esc(occ.id) + '"><iconify-icon slot="start" icon="fluent:sparkle-16-filled" width="14" height="14" aria-hidden="true"></iconify-icon>Explain this crash</fluent-button>' : "";
    var aiPanel = f.resolved ? '<div class="crashai" id="crashai-occ-' + esc(occ.id) + '" hidden>' + crashInsightHTML(app, f, sb.parts, env, occ) + '</div>' : "";
    return '<div class="occdlg__ctx"><iconify-icon icon="fluent:document-bullet-list-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon><span><strong>' + esc(occ.date) + '</strong> \u00b7 ' + esc(occ.dev) + ' \u00b7 ' + esc(occ.model) + ' \u00b7 <span class="mono">' + esc(occ.os) + '</span></span></div>' +
      '<div class="occdlg__meta">' + badge + '<span class="muted stk__excn">' + esc(f.code) + ' \u00b7 ' + esc(f.type) + '</span>' +
      '<span class="occdlg__actions">' + aiBtn +
      '<fluent-button appearance="outline" size="small" data-copy-stack="' + f.id + '"><iconify-icon slot="start" icon="fluent:copy-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Copy</fluent-button>' +
      '<fluent-button appearance="outline" size="small" data-dl-dump="' + esc(occ.id) + '"><iconify-icon slot="start" icon="fluent:arrow-download-16-regular" width="14" height="14" aria-hidden="true"></iconify-icon>Crash dump (.cab)</fluent-button></span></div>' +
      '<div class="stk ' + (f.resolved ? "stk--resolved" : "stk--unresolved") + '">' + sb.html + '</div>' +
      aiPanel +
      '<p class="occdlg__note muted">This occurrence shares the failure\u2019s signature \u2014 download its crash dump to debug this exact instance in your debugger.</p>';
  }
  function openOccStack(occId) {
    var app = appById(analyticsAppId) || state.apps[0];
    var f = app && anaData(app).failures.filter(function (x) { return x.id === anaFailure; })[0]; if (!f) return;
    var occ = failureDetail(app, f).log.filter(function (o) { return o.id === occId; })[0]; if (!occ) return;
    var body = $("occDialogBody"), sub = $("occDialogSub"); if (!body) return;
    if (sub) sub.textContent = " \u00b7 " + f.ver;
    body.innerHTML = occStackHTML(app, f, occ);
    var d = $("occDialog"); if (d) d.show();
  }
  function closeOccStack() { var d = $("occDialog"); if (d) d.hide(); }
  function versionsForFailure(app, f) {
    var d = anaData(app), tot = f.hits;
    var main = { label: f.ver, hits: Math.round(tot * 0.86), pct: 86 };
    var others = d.versions.filter(function (v) { return v.ver !== f.ver; }).slice(0, 2).map(function (v, i) { var p = i ? 4 : 10; return { label: v.ver, hits: Math.round(tot * p / 100), pct: p }; });
    return [main].concat(others);
  }
  function impactedVersionsHTML(app, f) {
    var rows = versionsForFailure(app, f).map(function (r) {
      return '<tr><td><button class="linklike faillink" data-ver-filter="' + esc(r.label) + '" title="Show failures on ' + esc(r.label) + '">' + esc(r.label) + '</button></td>' +
        '<td class="num">' + fmtComma(r.hits) + ' <span class="muted">(' + r.pct.toFixed(0) + '%)</span></td></tr>';
    }).join("");
    return '<div class="table-wrap"><table class="atable"><thead><tr><th>App version</th><th class="num">Hits</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function failureView(app, d) {
    var f = d.failures.filter(function (x) { return x.id === anaFailure; })[0];
    if (!f) { anaFailure = null; return crashTab(app); }
    var det = failureDetail(app, f);
    var cpuRows = det.cpu.map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td class="num">' + c[1].toFixed(1) + '%</td></tr>'; }).join("");
    return '<button class="aback" data-anaback="1"><iconify-icon icon="fluent:chevron-left-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon>Back to overview</button>' +
      '<div class="failhead"><div class="failhead__id"><span class="muted">Failure</span><span class="failhead__name mono">' + esc(f.name) + '</span></div>' +
        '<div class="failhead__meta">' + ftypePill(f.type) + '<span class="mono muted">' + esc(f.ver) + '</span><span class="mono muted">' + esc(f.code) + '</span><strong>' + fmtComma(f.hits) + ' hits</strong></div></div>' +
      '<div id="ca-stacksec">' + apanel("Stack trace", stackTraceHTML(app, f, det)) + '</div>' +
      apanel("Failure hits", chartLine({ series: det.hits.series, labels: det.hits.labels, area: true }) + chartLegend(det.hits.series)) +
      '<div class="apanel-grid">' +
        apanel("Impacted app versions", impactedVersionsHTML(app, f)) +
        apanel("Device configuration \u00b7 CPU", '<table class="atable atable--sm"><thead><tr><th>CPU</th><th class="num">Share</th></tr></thead><tbody>' + cpuRows + '</tbody></table>') +
      '</div>' +
      failureLogPanel(app, f);
  }
  function failureLogPanel(app, f) {
    return '<section class="apanel" id="ca-logsec"><header class="apanel__head"><h3>Failure log</h3>' +
      '<iconify-icon class="apanel__i" icon="fluent:info-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon></header>' +
      '<p class="apanel__sub muted">Every reported occurrence from the last 30 days \u2014 open its stack trace or download the crash dump (.cab) to debug locally.</p>' +
      '<div class="failctl"><fluent-text-input id="failLogSearch" appearance="outline" class="failsearch" placeholder="Search occurrences\u2026" value="' + esc(anaLogQuery) + '"><iconify-icon slot="start" icon="fluent:search-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon></fluent-text-input></div>' +
      '<div id="failLogHost">' + failLogInner(app, f) + '</div></section>';
  }
  function failLogInner(app, f) {
    var det = failureDetail(app, f), list = det.log.slice();
    if (anaLogQuery) { var q = anaLogQuery.toLowerCase(); list = list.filter(function (r) { return (r.model + " " + r.os + " " + r.ver + " " + r.dev + " " + r.date).toLowerCase().indexOf(q) >= 0; }); }
    var per = 6, pages = Math.max(1, Math.ceil(list.length / per)), pg = Math.max(0, Math.min(anaLogPage, pages - 1));
    var rows = list.slice(pg * per, pg * per + per).map(function (r) {
      return '<tr><td>' + esc(r.date) + '</td><td><span class="mono">' + esc(r.ver) + '</span></td><td>' + esc(r.dev) + '</td><td>' + esc(r.model) + '</td><td><span class="mono">' + esc(r.os) + '</span></td>' +
        '<td class="atable__act occ-links"><fluent-link data-occ-stack="' + r.id + '">Stack trace</fluent-link><fluent-link data-dl-dump="' + r.id + '">Crash dump</fluent-link></td></tr>';
    }).join("");
    if (!list.length) rows = '<tr><td colspan="6" class="cellspan">No occurrences match your search.</td></tr>';
    return '<div class="table-wrap"><table class="atable"><thead><tr><th>Date</th><th>Package version</th><th>Device type</th><th>Device model</th><th>OS build</th><th>Links</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      pagerHTML(pg, pages, "data-analogpage", list.length, "occurrences");
  }
  function renderFailLogHost() { var h = $("failLogHost"); if (!h) return; var app = appById(analyticsAppId) || state.apps[0], f = app && anaData(app).failures.filter(function (x) { return x.id === anaFailure; })[0]; if (f) h.innerHTML = failLogInner(app, f); }
  /* ----- Symbol uploader (Fluent dialog shell #symDialog) ----- */
  function openSymUploader(app, ver) { symUp = { appId: app.id, ver: ver || "", phase: "pick", file: null }; renderSymUploader(); var d = $("symDialog"); if (d) d.show(); }
  function openSymDetails(app, ver) { symUp = { appId: app.id, ver: ver || "", phase: "error", file: null }; renderSymUploader(); var d = $("symDialog"); if (d) d.show(); }
  function closeSymUploader() { symUp = null; var d = $("symDialog"); if (d) d.hide(); }
  function startSymValidate() {
    if (!symUp || !symUp.file) return;
    symUp.phase = "validating"; renderSymUploader();
    var bad = /bad|corrupt|wrong|mismatch|nopdb/i.test(symUp.file);
    setTimeout(function () {
      if (!symUp) return;
      if (bad) { symUp.phase = "error"; renderSymUploader(); return; }
      var app = appById(symUp.appId); if (!app) return; var d = anaData(app);
      var ver = symUp.ver || d.versions[0].ver, vo = d.versions.filter(function (v) { return v.ver === ver; })[0];
      if (vo) vo.sym = "processing";
      d.history.unshift({ id: "h" + Date.now(), file: symUp.file, ver: ver, status: "processing", size: "\u2014", by: "you@contoso.com", date: new Date().toLocaleDateString("en-US") });
      d.symbolHealth = Math.round(d.versions.filter(function (v) { return v.sym === "resolved"; }).length / d.versions.length * 100);
      symUp.phase = "done"; symUp.ver = ver; renderSymUploader(); renderAnalyticsPanel();
    }, 1600);
  }
  function renderSymUploader() {
    if (!symUp) return;
    var app = appById(symUp.appId), body = $("symDialogBody"), titleEl = $("symDialogTitle"); if (!app || !body) return;
    if (titleEl) titleEl.textContent = "Upload symbols" + (symUp.ver ? " \u00b7 " + symUp.ver : "");
    var html;
    if (symUp.phase === "pick") html = '<div class="symdrop" id="symDrop"><iconify-icon icon="fluent:folder-zip-24-regular" width="34" height="34" aria-hidden="true"></iconify-icon>' +
      '<strong>Drop your symbol package (.zip) here</strong><span class="muted">or</span><fluent-button size="small" appearance="outline" id="symBrowse">Browse\u2026</fluent-button><input type="file" id="symFile" accept=".zip,.pdb" hidden>' +
      (symUp.file ? '<div class="symfile"><iconify-icon icon="fluent:document-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon>' + esc(symUp.file) + '</div>' : "") + '</div>' +
      '<div class="symguide"><strong>What to upload</strong><ul><li>Your full build output as a <b>.zip</b> \u2014 the app\u2019s <span class="mono">.exe</span>/<span class="mono">.dll</span> files <b>and</b> their matching <span class="mono">.pdb</span> symbols.</li>' +
      '<li>We auto-detect the app and version from the binaries, so you don\u2019t have to sort them.</li>' +
      '<li>A bare <span class="mono">.pdb</span> can\u2019t be matched \u2014 include the binaries it was built with.</li></ul>' +
      '<fluent-link href="#" data-noop="1">Learn more about symbol packaging \u2192</fluent-link></div>' +
      '<div class="symfoot"><fluent-button appearance="subtle" data-sym-close="1">Cancel</fluent-button><fluent-button appearance="primary" data-sym-start="1"' + (symUp.file ? "" : " disabled") + '>Upload &amp; validate</fluent-button></div>';
    else if (symUp.phase === "validating") html = '<div class="symstate"><fluent-spinner size="medium"></fluent-spinner><strong>Validating &amp; indexing your symbols\u2026</strong><p class="muted">We\u2019re checking the package matches your binaries. This usually takes a few minutes \u2014 you can close this and come back; we\u2019ll keep working \u2014 and we\u2019ll email you the moment it\u2019s done.</p></div>';
    else if (symUp.phase === "done") html = '<div class="symstate"><iconify-icon class="symstate__ok" icon="fluent:checkmark-circle-24-filled" width="46" height="46" aria-hidden="true"></iconify-icon><strong>Symbols accepted for ' + esc(symUp.ver || "detected versions") + '</strong><p class="muted">Validation passed. Your <strong>future</strong> crashes will start showing resolved stack traces within the next <strong>24 hours</strong>. Crashes that already happened stay unresolved. We\u2019ll email you when processing finishes \u2014 whether it resolves or needs your attention.</p><div class="symfoot symfoot--center"><fluent-button appearance="primary" data-sym-close="1">Done</fluent-button></div></div>';
    else html = '<div class="symstate"><iconify-icon class="symstate__err" icon="fluent:error-circle-24-filled" width="46" height="46" aria-hidden="true"></iconify-icon><strong>Action needed' + (symUp.ver ? " on " + esc(symUp.ver) : "") + '</strong><p class="muted">' + esc(SYM_ERR.msg) + '</p><div class="symerr"><span class="mono">' + SYM_ERR.code + '</span></div><div class="symfoot symfoot--center"><fluent-button appearance="primary" data-sym-retry="1">Upload again</fluent-button></div></div>';
    body.innerHTML = html;
    var br = $("symBrowse"), fi = $("symFile");
    if (br && fi) br.addEventListener("click", function () { fi.click(); });
    if (fi) fi.addEventListener("change", function () { symUp.file = (fi.files[0] && fi.files[0].name) || null; renderSymUploader(); });
    var dz = $("symDrop");
    if (dz) { dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("is-over"); });
      dz.addEventListener("dragleave", function () { dz.classList.remove("is-over"); });
      dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("is-over"); var fl = e.dataTransfer.files[0]; symUp.file = fl ? fl.name : "symbols.zip"; renderSymUploader(); }); }
  }
  function downloadText(name, text) {
    try { var b = new Blob([text], { type: "text/plain" }), u = URL.createObjectURL(b), a = document.createElement("a");
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(u); }, 1000); } catch (e) {}
  }

  // WDP path: once at least one app is on the Store, nudge the developer to publish the
  // rest. Store path: every app's full analytics are already available, so no upsell.
  function analyticsUpsell() {
    if (STORE) return "";
    var total = state.apps.length, live = state.apps.filter(function (a) { return a.store; }).length, rest = total - live;
    if (live < 1 || rest < 1) return "";
    return '<div class="ana-upsell">' +
      '<iconify-icon class="ana-upsell__ico" icon="fluent:rocket-20-regular" width="22" height="22" aria-hidden="true"></iconify-icon>' +
      '<div class="ana-upsell__text"><strong>' + live + ' of ' + total + ' apps are on the Microsoft Store.</strong>' +
        '<span class="muted">Bring the other ' + rest + ' to unlock acquisition, usage, ratings &amp; reviews, and performance for them too.</span></div>' +
      '<a class="ana-upsell__cta" href="#apps" data-jump="apps">Bring apps to the Store →</a>' +
    '</div>';
  }
  function renderAnalyticsPanel() {
    var panelEl = $("analyticsPanel");
    var app = appById(analyticsAppId) || state.apps[0];
    if (!app) { panelEl.innerHTML = emptyAnalyticsHTML(); return; }
    // Health is always available. Store tabs lock until the app is on the Store, then show
    // the full detailed dashboard. Full re-render each time so the tab lock icons track the app.
    var tab = ANA_TABS.filter(function (t) { return t.key === anaTab; })[0] || ANA_TABS[0];
    var body = tabLocked(tab, app) ? lockedAnalyticsHTML(app, tab)
      : anaTab === "crashes" ? crashTab(app)
      : anaTab === "acquisition" ? acquisitionTab(app)
      : anaTab === "usage" ? usageTab(app)
      : anaTab === "ratings" ? ratingsTab(app)
      : crashTab(app);
    panelEl.innerHTML = analyticsUpsell() + anaTabsHTML(app) + '<div class="anabody">' + body + '</div>';
    var dsHost = document.getElementById("demoSwitchHost");
    if (!dsHost) { dsHost = document.createElement("div"); dsHost.id = "demoSwitchHost"; document.body.appendChild(dsHost);
      dsHost.addEventListener("click", function (e) { var dms = e.target.closest("[data-demostate]"); if (dms) { anaDemoState = dms.getAttribute("data-demostate"); anaFailure = null; anaPage = 0; renderAnalyticsPanel(); } }); }
    dsHost.innerHTML = (anaTab === "crashes" && !anaFailure) ? demoSwitchHTML() : "";
    var fsel = $("failSearch");
    if (fsel) fsel.addEventListener("input", function () { anaSearch = fsel.value || ""; anaPage = 0; renderFailTableHost(); });
    var tsel = $("anaTypeSel");
    if (tsel) tsel.addEventListener("change", function () { if (!tsel.value) return; anaType = tsel.value; anaPage = 0; renderFailTableHost(); });
    var lsel = $("failLogSearch");
    if (lsel) lsel.addEventListener("input", function () { anaLogQuery = lsel.value || ""; anaLogPage = 0; renderFailLogHost(); });
  }
  function renderAnalytics() {
    var panelEl = $("analyticsPanel"), controls = $("anaControls");
    // Store portal: analytics only exist for apps live in the Store (or brought in via cert).
    var liveApps = STORE ? state.apps.filter(function (a) { return a.store || a.discovered; }) : state.apps;
    if (!liveApps.length) { if (controls) controls.hidden = true; panelEl.innerHTML = emptyAnalyticsHTML(); return; }
    if (controls) controls.hidden = false;
    if (!analyticsAppId || !liveApps.some(function (a) { return a.id === analyticsAppId; })) analyticsAppId = liveApps[0].id;
    renderAppSelect(liveApps);
    renderAnaFilter();
    renderAnaChips();
    renderAnalyticsPanel();
  }
  function renderAnaFilter() {
    var el = $("anaFilterBar"); if (!el) return;
    el.innerHTML = anaFilterHTML();
    var rs = $("anaRangeSel");
    if (rs) rs.addEventListener("change", function () { if (!rs.value) return; anaRange = rs.value; if (anaRange !== "custom") anaCustom = null; anaPage = 0; renderAnaFilter(); renderAnalyticsPanel(); });
    Array.prototype.forEach.call(el.querySelectorAll(".anaqf"), function (dd) {
      dd.addEventListener("change", function () {
        var key = dd.getAttribute("data-qf"), val = dd.value;
        if (!val || val === "__multi") return;
        var cur = anaFilters[key] || [], next = val === "__all" ? [] : [val];
        if (cur.length === next.length && cur.every(function (x, i) { return x === next[i]; })) return;
        if (next.length) anaFilters[key] = next; else delete anaFilters[key];
        anaPage = 0; renderAnaFilter(); renderAnaChips(); renderAnalyticsPanel();
      });
    });
  }
  function renderAppSelect(apps) {
    var el = $("anaAppSel"); if (!el) return;
    var cur = appById(analyticsAppId) || apps[0];
    el.innerHTML = '<fluent-dropdown id="anaAppDd" appearance="outline" aria-label="Select app" placeholder="Select app"><fluent-listbox>' + apps.map(function (a) {
      return '<fluent-option value="' + a.id + '"' + (a.id === cur.id ? " selected" : "") + '>' + appIcoImg(a) + '<span class="opt-name">' + esc(a.name) + '</span></fluent-option>';
    }).join("") + '</fluent-listbox></fluent-dropdown>';
    var dd = $("anaAppDd");
    if (dd) {
      dd.addEventListener("change", function () { var v = dd.value; if (!v || v === analyticsAppId) return; analyticsAppId = v; anaFailure = null; anaPage = 0; anaSearch = ""; anaType = "all"; anaCause = null; renderAnalytics(); });
      // Fluent dropdown builds a text-only combobox trigger; inject the current app's logo into it.
      var tries = 0;
      (function injectAppLogo() {
        var btn = dd.querySelector('button[role="combobox"]');
        if (btn) { if (!btn.querySelector(".app-ico")) btn.insertAdjacentHTML("afterbegin", appIcoImg(cur)); return; }
        if (tries++ < 20) setTimeout(injectAppLogo, 30);
      })();
    }
  }
  // ----- Analytics filters (page-level, shared across tabs) -----
  var FILTER_CATS = [
    { key: "market", label: "Market", values: ["United States", "India", "Nigeria", "United Kingdom", "Germany", "Brazil", "Japan", "Canada"] },
    { key: "device", label: "Device type", values: ["Desktop", "Laptop", "Tablet", "Workstation", "All-in-one"] },
    { key: "appver", label: "Application version", values: null },
    { key: "osver", label: "OS version", values: ["Windows 11 24H2", "Windows 11 23H2", "Windows 10 22H2"] },
    { key: "osrel", label: "OS release version", values: ["10.0.26100", "10.0.22631", "10.0.19045"] },
    { key: "arch", label: "Architecture", values: ["x64", "arm64", "x86"] }
  ];
  function filterCount() { var n = 0, k; for (k in anaFilters) if (anaFilters.hasOwnProperty(k)) n += (anaFilters[k] || []).length; return n; }
  function removeFilter(k, v) {
    if (anaFilters[k]) { anaFilters[k] = anaFilters[k].filter(function (x) { return x !== v; }); if (!anaFilters[k].length) delete anaFilters[k]; }
    renderAnaFilter(); renderAnaChips(); anaPage = 0; renderAnalyticsPanel();
  }
  function renderAnaChips() {
    var el = $("anaChips"); if (!el) return;
    var chips = [];
    FILTER_CATS.forEach(function (c) { (anaFilters[c.key] || []).forEach(function (v) {
      chips.push('<span class="fchip">' + esc(c.label) + ': ' + esc(v) + '<button class="fchip__x" data-chip-rm="' + esc(c.key) + '|' + esc(v) + '" aria-label="Remove filter">\u00d7</button></span>');
    }); });
    if (!chips.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = chips.join("") + '<button class="fchip-clear" data-filters-clear="1">Clear all</button>';
  }
  function openFilterFlyout() {
    var app = appById(analyticsAppId), body = $("filterDrawerBody"); if (!app || !body) return;
    var appvers = anaData(app).versions.map(function (v) { return v.ver; });
    body.innerHTML = FILTER_CATS.map(function (c) {
      var vals = c.key === "appver" ? appvers : c.values, sel = (anaFilters[c.key] || []).length;
      var opts = vals.map(function (v) { var on = (anaFilters[c.key] || []).indexOf(v) >= 0;
        return '<label class="filtopt"><fluent-checkbox data-fk="' + esc(c.key) + '" value="' + esc(v) + '"' + (on ? " checked" : "") + '></fluent-checkbox><span class="filtopt__t">' + esc(v) + '</span></label>'; }).join("");
      return '<details class="filtsec"' + (sel ? " open" : "") + '><summary>' + esc(c.label) + (sel ? ' <fluent-counter-badge count="' + sel + '" appearance="filled" color="brand" size="small"></fluent-counter-badge>' : "") + '</summary><div class="filtsec__body">' + opts + '</div></details>';
    }).join("");
    var d = $("filterDrawer"); if (d) d.show();
  }
  function closeFilterFlyout() { var d = $("filterDrawer"); if (d) d.hide(); }
  function clearFilterDrawer() { var body = $("filterDrawerBody"); if (body) Array.prototype.forEach.call(body.querySelectorAll("fluent-checkbox"), function (cb) { cb.checked = false; }); }
  function applyFiltersFromDrawer() {
    var body = $("filterDrawerBody"), next = {};
    if (body) Array.prototype.forEach.call(body.querySelectorAll("fluent-checkbox"), function (cb) { if (cb.checked) { var k = cb.getAttribute("data-fk"); (next[k] = next[k] || []).push(cb.getAttribute("value")); } });
    anaFilters = next; closeFilterFlyout(); renderAnaFilter(); renderAnaChips(); anaPage = 0; renderAnalyticsPanel();
  }
  // ----- Symbol upload history dialog (#histDialog) -----
  function openSymHistory(app) {
    var body = $("histDialogBody"), sub = $("histDialogSub"); if (!body) return;
    if (sub) sub.textContent = " \u00b7 " + app.name;
    body.innerHTML = '<p class="muted symmodal__lead">Every upload for this app, visible to your whole team \u2014 with the original package to re-download.</p>' + symbolHistoryTable(app);
    var d = $("histDialog"); if (d) d.show();
  }
  function closeSymHistory() { var d = $("histDialog"); if (d) d.hide(); }
  function readDropdownValue(sel) {
    if (sel.value) return sel.value;
    var o = sel.querySelector('fluent-option[aria-selected="true"], fluent-option[selected]');
    return o ? o.getAttribute("value") : null;
  }

  /* ---------------- cert + app creation ---------------- */
  function getOrCreateCert(info, file) {
    var thumb = info.signerThumbprint || info.fileSha256;
    var existing = state.certs.filter(function (c) { return c.thumb === thumb; })[0];
    if (existing) return { cert: existing, created: false };
    var cert = {
      id: uid(),
      label: cnOf(info.signerSubject) || file.name.replace(/\.[^.]+$/, ""),
      subject: info.signerSubject || null, issuer: info.issuer || null,
      thumb: thumb, thumbKind: info.signerThumbprint ? "cert" : "hash",
      trust: info.status || "Unknown", signed: !!info.signerThumbprint, added: today()
    };
    state.certs.push(cert);
    return { cert: cert, created: true };
  }
  // Find apps already running on this PC that are signed by the same certificate,
  // and add them automatically (one cert → all its apps).
  async function discoverApps(thumb, certId) {
    if (!thumb) return;
    scanning = true; renderApps();
    toast("Scanning installed apps signed with this certificate…", true);
    var added = 0, refreshed = 0;
    try {
      var res = await fetch("/api/apps-by-cert?thumbprint=" + encodeURIComponent(thumb));
      if (res.ok) {
        var list = await res.json();
        if (Array.isArray(list)) list.forEach(function (a) {
          var key = "p:" + (a.path || (a.file + a.sizeKB));
          var existing = state.apps.filter(function (x) { return x.discoveryKey === key; })[0];
          if (existing) { // re-scan refreshes the (now high-res) icon in place
            if (a.icon && a.icon !== existing.icon) { existing.icon = a.icon; refreshed++; }
            return;
          }
          state.apps.push({
            id: uid(), name: a.name || a.file, file: a.file, size: a.version ? "v" + a.version : (a.sizeKB ? a.sizeKB + " KB" : ""),
            icon: a.icon || null, signerThumb: thumb, signerSubject: null, trust: "Valid", certId: certId,
            sources: [], store: false, added: today(), discoveryKey: key, discovered: true
          });
          added++;
        });
      }
    } catch (e) {}
    scanning = false;
    if (added || refreshed) save();
    renderAll();
    toast(added ? "Found " + added + " app" + (added > 1 ? "s" : "") + " signed by this certificate"
                : refreshed ? "Refreshed " + refreshed + " app icon" + (refreshed > 1 ? "s" : "") + " in high resolution"
                : "No other installed apps use this certificate", !added);
  }
  function rescanApps() {
    var certs = state.certs.filter(function (c) { return c.thumbKind === "cert"; });
    if (!certs.length) { toast("Add a certificate first", true); return; }
    certs.forEach(function (c) { discoverApps(c.thumb, c.id); });
  }
  // ===== TEMP DEMO (store portal, revert later) =========================================
  // Once an app is published in the Store portal we "recognize" the developer's code signing
  // certificate (the published app was a signed Win32 app) and surface their OTHER signed apps
  // via the REAL /api/apps-by-cert scan (same one the WDP portal uses) — so they can manage
  // Store distribution and view health analytics. Scans once. To revert: delete this function +
  // the `if (STORE) discoverStoreApps()` call in doCreateApp + the store scanning banner/note in
  // renderApps + the .disc-note CSS.
  async function discoverStoreApps() {
    if (!STORE || scanning) return;
    if (state.apps.some(function (a) { return a.storeDiscovered; })) return;   // scan only once
    // Real Microsoft code signing certificate — the same one used in WDP (from signing-demo/trusted-sample.exe).
    var CS_THUMB = "1D6C5C2964313A6FD555B53BB6FFE077A4FA82F2";
    var certId = uid();
    state.certs.push({ id: certId, label: "Microsoft Corporation", thumb: CS_THUMB,
      thumbKind: "cert", trust: "Valid", signed: true, added: today(), verified: false });
    scanning = true; renderApps();
    // Populate the REAL apps signed by this certificate — the same /api/apps-by-cert scan the WDP portal uses.
    var added = 0;
    try {
      var res = await fetch("/api/apps-by-cert?thumbprint=" + encodeURIComponent(CS_THUMB));
      if (res.ok) {
        var list = await res.json();
        if (Array.isArray(list)) list.forEach(function (a) {
          state.apps.push({
            id: uid(), name: a.name || a.file, file: a.file,
            size: a.version ? "v" + a.version : (a.sizeKB ? a.sizeKB + " KB" : ""),
            icon: a.icon || null, signerThumb: CS_THUMB, signerSubject: null, trust: "Valid", certId: certId,
            sources: [], store: false, added: today(), discovered: true, storeDiscovered: true
          });
          added++;
        });
      }
    } catch (e) {}
    scanning = false; save(); renderAll();
    toast(added ? "Found " + added + " app" + (added > 1 ? "s" : "") + " signed by your certificate"
                : "No other apps found for this certificate", !added);
  }
  // ===== END TEMP DEMO ==================================================================

  /* ---------------- Add-certificate modal (reuses the same flow) ---------------- */
  function openModal() {
    var body = $("modalFlowBody"); body.innerHTML = flowHTML(false); wireFlow(body);
    $("certModal").hidden = false; document.addEventListener("keydown", escModal);
  }
  function closeModal() {
    var m = $("certModal"); if (!m) return;
    m.hidden = true; var b = $("modalFlowBody"); if (b) b.innerHTML = "";
    document.removeEventListener("keydown", escModal); pending = [];
  }
  function escModal(e) { if (e.key === "Escape") closeModal(); }

  /* ---------------- Download sources modal ---------------- */
  var currentSrc = null;
  function appById(id) { return state.apps.filter(function (a) { return a.id === id; })[0] || null; }
  function openSources(id) {
    var a = appById(id); if (!a) return;
    if (!a.sources) a.sources = [];
    currentSrc = id; $("srcAppName").textContent = a.name ? " · " + a.name : "";
    renderSources(); $("srcInput").value = "";
    var dlg = $("sourcesModal"); if (dlg.show) dlg.show(); // native modal: backdrop + Esc + focus-trap
    setTimeout(function () { try { $("srcInput").focus(); } catch (e) {} }, 40);
  }
  // Every close path (X, Done, Esc, backdrop) ends in the dialog's "toggle"→closed
  // event, where cleanup runs exactly once — see wireSources().
  function closeSources() { var dlg = $("sourcesModal"); if (dlg.hide) dlg.hide(); }
  function renderSources() {
    var a = appById(currentSrc); if (!a) return;
    var el = $("srcList"), s = a.sources || [];
    if (!s.length) { el.innerHTML = '<li class="src-empty">No sources declared yet. Add the URLs your app downloads from.</li>'; return; }
    el.innerHTML = s.map(function (x) {
      return '<li class="source-row"><span class="source-row__url">' + esc(x.url) + '</span>' +
        '<div class="segmented" data-src="' + x.id + '">' +
          '<button data-val="allow" aria-pressed="' + (x.status === "allow") + '">Allow</button>' +
          '<button data-val="block" aria-pressed="' + (x.status === "block") + '">Block</button>' +
        '</div>' +
        '<button class="dropzone__clear" data-rmsrc="' + x.id + '" aria-label="Remove">✕</button></li>';
    }).join("");
  }
  function addSource() {
    var inp = $("srcInput"), v = (inp.value || "").trim(); if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    var a = appById(currentSrc); if (!a) return;
    if (!a.sources) a.sources = [];
    a.sources.push({ id: uid(), url: v, status: "allow" });
    save(); inp.value = ""; renderSources();
  }
  function wireSources() {
    $("srcAdd").addEventListener("click", addSource);
    $("srcInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addSource(); } });
    $("srcList").addEventListener("click", function (e) {
      var seg = e.target.closest(".segmented button");
      if (seg) {
        var sid = seg.parentElement.getAttribute("data-src"), a = appById(currentSrc);
        var src = (a.sources || []).filter(function (x) { return x.id === sid; })[0];
        if (src) { src.status = seg.getAttribute("data-val"); save();
          seg.parentElement.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", b === seg); }); }
        return;
      }
      var rm = e.target.closest("[data-rmsrc]");
      if (rm) { var a2 = appById(currentSrc); a2.sources = (a2.sources || []).filter(function (x) { return x.id !== rm.getAttribute("data-rmsrc"); }); save(); renderSources(); }
    });
    $("sourcesModal").addEventListener("click", function (e) { if (e.target.closest("[data-srcclose]")) closeSources(); });
    $("sourcesModal").addEventListener("toggle", function (e) {
      if (e.detail && e.detail.newState === "closed") { currentSrc = null; renderApps(); }
    });
  }

  /* ---------------- Publish to Store → reserve name, then the full v4 flow ----------------
     Step 1: "Publish to Store" opens the reserve-name dialog (app name + default language).
     Step 2: "Create app" reserves it, marks the app in-progress in the table, and hands off
     to the embedded v4 publishing flow (publishing/publish-v2.html). Created apps can be
     re-opened later by clicking their row. On submit, tdp-bridge.js writes the result back
     so the table shows "In Store". */
  var publishId = null;
  function escPub(e) { if (e.key === "Escape") closePublish(); }
  function openPublish(id) {
    var a = appById(id); if (!a) return;
    publishId = id;
    if ($("pubTitle")) $("pubTitle").textContent = "Publish to the Store";
    var nm = $("pubName");
    nm.value = (a.storeName || a.name).replace(/\.[^.]+$/, "");
    $("pubLang").value = a.storeLang || "en-US";
    $("publishModal").hidden = false;
    document.addEventListener("keydown", escPub);
    checkPubName();
    setTimeout(function () { try { nm.focus(); nm.select(); } catch (e) {} }, 40);
  }
  // "Create new app" — reserve a name for a brand-new app (not a discovered one).
  function openNewApp() {
    publishId = null;
    if ($("pubTitle")) $("pubTitle").textContent = "Create a new app";
    $("pubName").value = "";
    $("pubLang").value = "en-US";
    $("publishModal").hidden = false;
    document.addEventListener("keydown", escPub);
    checkPubName();
    setTimeout(function () { try { $("pubName").focus(); } catch (e) {} }, 40);
  }
  function closePublish() { $("publishModal").hidden = true; document.removeEventListener("keydown", escPub); publishId = null; }
  function checkPubName() {
    var v = ($("pubName").value || "").trim(), hint = $("pubNameHint"), btn = $("pubCreate");
    if (v.length < 2) {
      hint.className = "field__hint"; hint.textContent = "Enter an app name to reserve.";
      btn.setAttribute("disabled", ""); return;
    }
    hint.className = "field__hint field__hint--ok";
    hint.innerHTML = '<span class="verified-dot"></span>“' + esc(v) + '” is available';
    btn.removeAttribute("disabled");
  }
  // "Create app": reserve the name (creating a brand-new app if there's no existing one),
  // add/mark it in-progress in the table immediately, then open the flow.
  function doCreateApp() {
    var name = ($("pubName").value || "").trim(); if (name.length < 2) return;
    var a = publishId ? appById(publishId) : null;
    if (!a) {                                            // new app — added to the table right now
      var cert = state.certs.filter(function (c) { return c.trust === "Valid"; })[0] || state.certs[0] || null;
      a = { id: uid(), name: name, file: name.replace(/\s+/g, "") + ".exe", size: "", icon: null,
        signerThumb: cert ? cert.thumb : null, signerSubject: null, trust: "Valid",
        certId: cert ? cert.id : null, sources: [], store: false, added: today(), created: true };
      state.apps.push(a);
    }
    a.storeName = name;
    a.storeLang = readDropdownValue($("pubLang")) || "en-US";
    a.storeCreated = a.storeCreated || today();
    if (!a.store) a.storeStatus = "in-progress";        // reserved → entering the flow
    save(); renderApps(); closePublish();               // persist + reflect the new row before navigating
    openPublishFlow(a.id);                              // launch the full publishing flow
  }
  function wirePublish() {
    $("publishModal").addEventListener("click", function (e) { if (e.target.closest("[data-pubclose]")) closePublish(); });
    $("pubCreate").addEventListener("click", doCreateApp);
    var nm = $("pubName");
    nm.addEventListener("input", checkPubName);
    nm.addEventListener("keyup", checkPubName);
    nm.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !$("pubCreate").hasAttribute("disabled")) { e.preventDefault(); doCreateApp(); }
    });
  }
  // Map the app into v4's localStorage shape and navigate to the full flow.
  function openPublishFlow(id) {
    var a = appById(id); if (!a) return;
    var ms; try { ms = JSON.parse(localStorage.getItem("msstore.apps")) || []; } catch (e) { ms = []; }
    if (!Array.isArray(ms)) ms = [];
    var mapped = {
      id: a.id, name: a.storeName || a.name, type: "win32", subtype: null,
      language: a.storeLang || "en-US",
      // published apps open straight to the live hub; only a freshly-submitted app is in-review
      status: a.storeStatus === "in-review" ? "in-review" : ((a.store || a.storeStatus === "published") ? "published" : "draft"),
      createdAt: a.storeCreated || new Date().toISOString()
    };
    // Seed the SAME logo shown in the portal Apps table so the flow header + live listing show it on
    // entry — a real image if the app has one, otherwise a faithful copy of the initials tile. A package
    // logo uploaded in the flow overrides this. baseLogo is flow-only and isn't merged back to the table.
    // Discovered-app icons are stored as BARE base64 (no data: prefix); normalize to a usable URL the same
    // way appIcoImg does, so the flow can paint it as a CSS background-image (a bare string renders nothing).
    var realIcon = a.icon ? (/^(data:|https?:|\/)/i.test(a.icon) ? a.icon : "data:image/png;base64," + a.icon) : null;
    if (realIcon) mapped.icon = realIcon;
    mapped.baseLogo = realIcon || tileDataUrl(a.name);
    var i = ms.map(function (x) { return x.id; }).indexOf(a.id);
    if (i >= 0) ms[i] = Object.assign({}, ms[i], mapped); else ms.push(mapped);
    try { localStorage.setItem("msstore.apps", JSON.stringify(ms)); } catch (e) {}
    location.href = "publishing/publish-v2.html?id=" + encodeURIComponent(a.id) + (STORE ? "&from=store" : "&from=wdp");
  }

  var STORE_MSA = { name: "Priya Nair", email: "priya.nair@outlook.com", initials: "PN" };

  // Demo: sign in as the WDP developer with a real certificate. Reads the REAL certificate from the
  // bundled signed binary (signing-demo/trusted-sample.exe) through the same Authenticode
  // path as the cert modal, then auto-discovers the apps signed by that certificate.
  async function seedWdpDemo() {
    try {
      var res = await fetch("signing-demo/trusted-sample.exe");
      if (!res.ok) return;
      var file = new File([await res.blob()], "trusted-sample.exe", { type: "application/octet-stream" });
      var info = await inspectFile(file);
      var gc = getOrCreateCert(info, file);
      if (gc.created && info.notAfter) gc.cert.notAfter = info.notAfter;
      if (state.certs.length) state.verified = true;
      save(); renderAll();
      if (gc.cert && gc.cert.thumbKind === "cert") discoverApps(gc.cert.thumb, gc.cert.id);
    } catch (e) {}
  }

  // Demo: sign in as the Store developer — 1 published app — and open the Store portal.
  function seedStoreDemo() {
    try {
      localStorage.setItem("tdp.portal.store.v1", JSON.stringify({
        signedIn: true, verified: true, account: STORE_MSA, certs: [],
        apps: [{
          id: "app-demo-store", name: "Pixel Paint Studio", icon: null,
          file: "PixelPaintStudio.exe", size: "", sources: [], created: true,
          store: true, storeStatus: "published", storeLang: "en-US",
          storeCreated: today(), added: today()
        }, {
          id: "app-demo-cert", name: "Northwind Invoicing", icon: null,
          file: "NorthwindInvoicing.exe", size: "", sources: [], created: true,
          store: false, storeStatus: "in-review", storeLang: "en-US",
          storeCreated: today(), added: today()
        }, {
          id: "app-demo-draft", name: "Mica Weather", icon: null,
          file: "MicaWeather.exe", size: "", sources: [], created: true,
          store: false, storeStatus: "in-progress", storeLang: "en-US",
          storeCreated: today(), added: today()
        }]
      }));
    } catch (e) {}
  }

  // Delete an app (with confirmation) — Store path only. Removes it from this portal and
  // the shared publish state (msstore.apps).
  var pendingDelId = null;
  function confirmDeleteApp(id) {
    var a = appById(id); if (!a) return;
    pendingDelId = id;
    if ($("delAppName")) $("delAppName").textContent = a.name;
    if ($("delModal")) $("delModal").hidden = false;
    document.addEventListener("keydown", escDel);
  }
  function closeDel() { if ($("delModal")) $("delModal").hidden = true; document.removeEventListener("keydown", escDel); pendingDelId = null; }
  function escDel(e) { if (e.key === "Escape") closeDel(); }
  function doDeleteApp(id) {
    state.apps = state.apps.filter(function (a) { return a.id !== id; });
    try {
      var ms = JSON.parse(localStorage.getItem("msstore.apps"));
      if (Array.isArray(ms)) localStorage.setItem("msstore.apps", JSON.stringify(ms.filter(function (x) { return x.id !== id; })));
    } catch (e) {}
    if (analyticsAppId === id) { analyticsAppId = null; anaFailure = null; }
    save(); renderAll(); toast("App deleted", true);
  }
  function wireDel() {
    var m = $("delModal"); if (!m) return;
    m.addEventListener("click", function (e) { if (e.target.closest("[data-delclose]")) closeDel(); });
    $("delConfirm").addEventListener("click", function () { var id = pendingDelId; closeDel(); if (id) doDeleteApp(id); });
  }

  /* ---------------- Global wiring ---------------- */
  function wire() {
    // WDP door (portal.html): Alex → real certificate demo. Store door (store-portal.html):
    // plain sign-in, no certificate flow. The second tile only exists on the WDP door.
    var t1 = $("msaTile");
    if (t1) t1.addEventListener("click", function () {
      if (STORE) {
        state.signedIn = true; state.account = DEMO_MSA; save(); showApp();
        toast("Signed in as " + DEMO_MSA.email, true);
        return;
      }
      state.signedIn = true; state.account = DEMO_MSA; state.verified = false;
      state.certs = []; state.apps = [];   // clean slate, then the real cert + apps load in
      save(); showApp();
      toast("Signed in as " + DEMO_MSA.email, true);
      seedWdpDemo();
    });
    var t2 = $("msaTile2");
    if (t2) t2.addEventListener("click", function () { seedStoreDemo(); location.href = "store-portal.html#apps"; });
    var other = $("msaOther");
    if (other) other.addEventListener("click", function () { toast("Demo build — use a listed account", true); });

    $("certModal").addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeModal(); });
    wireSources();
    wirePublish();
    wireDel();
    // Apps value banner (WDP path): show unless the developer dismissed it before.
    var hero = $("appsHero");
    if (hero) { try { hero.hidden = localStorage.getItem("wdp.appsHero.dismissed") === "1"; } catch (_) { hero.hidden = false; } }

    document.querySelector(".main").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var fr = e.target.closest && e.target.closest("[data-failure]");
      if (fr) { e.preventDefault(); anaFailure = fr.getAttribute("data-failure"); window.scrollTo(0, 0); renderAnalyticsPanel(); return; }
      var kc = e.target.closest && e.target.closest("[data-cause]");
      if (kc) { e.preventDefault(); anaCause = kc.getAttribute("data-cause"); anaType = "all"; anaSearch = ""; anaPage = 0; renderAnalyticsPanel(); var _kfs = document.getElementById("ca-failsec"); if (_kfs) _kfs.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      var ss = e.target.closest && e.target.closest("[data-anasort]");
      if (ss) { e.preventDefault(); var sk = ss.getAttribute("data-anasort"); if (anaSort.key === sk) anaSort.dir = anaSort.dir === "asc" ? "desc" : "asc"; else { anaSort.key = sk; anaSort.dir = "desc"; } anaPage = 0; renderFailTableHost(); return; }
      var ssk2 = e.target.closest && e.target.closest("[data-symsort]");
      if (ssk2) { e.preventDefault(); var sk2 = ssk2.getAttribute("data-symsort"); if (symSort.key === sk2) symSort.dir = symSort.dir === "asc" ? "desc" : "asc"; else { symSort.key = sk2; symSort.dir = "desc"; } renderSymTableHost(); return; }
    });
    document.querySelector(".main").addEventListener("click", function (e) {
      if (e.target.closest("[data-openmodal]")) { e.preventDefault();
        // Store: the certs section IS the entry for adding your first cert, so always open the
        // dialog. WDP: before verifying, route to the overview's verify flow.
        if (STORE || state.verified) openModal(); else goView("overview"); return; }
      if (e.target.closest("[data-newapp]")) { openNewApp(); return; }
      if (e.target.closest("[data-rescan]")) { rescanApps(); return; }
      if (e.target.closest("[data-hero-dismiss]")) {
        try { localStorage.setItem("wdp.appsHero.dismissed", "1"); } catch (_) {}
        var hb = $("appsHero"); if (hb) hb.hidden = true; return;
      }
      var rep = e.target.closest("[data-report]");
      if (rep) { location.href = "publishing/cert-report.html?id=" + encodeURIComponent(rep.getAttribute("data-report")); return; }
      var ms = e.target.closest("[data-sources]");
      if (ms) { openSources(ms.getAttribute("data-sources")); return; }
      var del = e.target.closest("[data-delapp]");
      if (del) { confirmDeleteApp(del.getAttribute("data-delapp")); return; }
      var store = e.target.closest("[data-store]");
      if (store) { openPublish(store.getAttribute("data-store")); return; }
      var cont = e.target.closest("[data-continue]");
      if (cont) { openPublishFlow(cont.getAttribute("data-continue")); return; }
      var an = e.target.closest("[data-analytics]");
      if (an) { analyticsAppId = an.getAttribute("data-analytics"); anaTab = "crashes"; anaFailure = null; anaPage = 0; anaSearch = ""; anaType = "all"; anaCause = null; goView("analytics"); renderAnalytics(); return; }
      var rc = e.target.closest("[data-removecert]");
      if (rc) { var cid = rc.getAttribute("data-removecert");
        state.certs = state.certs.filter(function (c) { return c.id !== cid; });
        state.apps.forEach(function (a) { if (a.certId === cid) a.certId = null; });
        if (!state.certs.length) state.verified = false;
        save(); renderAll(); toast("Certificate removed", true); return; }
      var openapp = e.target.closest("[data-openapp]");
      if (openapp) { openPublishFlow(openapp.getAttribute("data-openapp")); return; }
      var atab = e.target.closest("[data-anatab]");
      if (atab) { anaTab = atab.getAttribute("data-anatab"); anaFailure = null; anaPage = 0; anaSearch = ""; anaType = "all"; anaCause = null; renderAnaFilter(); renderAnalyticsPanel(); return; }
      if (e.target.closest("[data-ai-dismiss]")) { aiDismissed[analyticsAppId] = true; renderAnalyticsPanel(); return; }
      if (e.target.closest("[data-cause-clear]")) { anaCause = null; anaPage = 0; renderFailTableHost(); return; }
      var rcc = e.target.closest("[data-cause]");
      if (rcc) { anaCause = rcc.getAttribute("data-cause"); anaType = "all"; anaSearch = ""; anaPage = 0; renderAnalyticsPanel(); var _fs = document.getElementById("ca-failsec"); if (_fs) _fs.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      var frow = e.target.closest("[data-failure]");
      if (frow && !e.target.closest("[data-sym-jump]")) { anaFailure = frow.getAttribute("data-failure"); anaLogPage = 0; anaLogQuery = ""; window.scrollTo(0, 0); renderAnalyticsPanel(); return; }
      var sj = e.target.closest("[data-sym-jump]");
      if (sj) { var sjsec = document.getElementById("ca-symsec"); var sjdet = sjsec && sjsec.querySelector("details.symacc"); if (sjdet) sjdet.open = true; if (sjsec) sjsec.scrollIntoView({ behavior: "smooth", block: "start" }); var sjrow = document.querySelector('#ca-symsec tr[data-ver="' + sj.getAttribute("data-sym-jump") + '"]'); if (sjrow) { sjrow.classList.remove("symhi"); void sjrow.offsetWidth; sjrow.classList.add("symhi"); } return; }
      var smg = e.target.closest("[data-sym-manage]");
      if (smg) { var smgv = smg.getAttribute("data-sym-manage"); anaFailure = null; renderAnalyticsPanel(); var smgsec = document.getElementById("ca-symsec"); var smgdet = smgsec && smgsec.querySelector("details.symacc"); if (smgdet) smgdet.open = true; if (smgsec) smgsec.scrollIntoView({ behavior: "smooth", block: "start" }); var smgrow = smgv && document.querySelector('#ca-symsec tr[data-ver="' + smgv + '"]'); if (smgrow) { smgrow.classList.remove("symhi"); void smgrow.offsetWidth; smgrow.classList.add("symhi"); } return; }
      if (e.target.closest("[data-anaback]")) { anaFailure = null; renderAnalyticsPanel(); return; }
      var ost = e.target.closest("[data-occ-stack]");
      if (ost) { openOccStack(ost.getAttribute("data-occ-stack")); return; }
      var ddp = e.target.closest("[data-dl-dump]");
      if (ddp) { var adp = appById(analyticsAppId), ffd = adp && anaData(adp).failures.filter(function (x) { return x.id === anaFailure; })[0]; if (ffd) { downloadText(ffd.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) + "_" + ddp.getAttribute("data-dl-dump") + "_dump.txt", "Crash dump (demo placeholder)\nFailure: " + ffd.name + "\nOccurrence: " + ddp.getAttribute("data-dl-dump") + "\n\n(The real .cab minidump would download here so you can debug locally.)"); toast("Downloading crash dump", true); } return; }
      var cloc = e.target.closest("[data-copy-loc]");
      if (cloc) { var locv = cloc.getAttribute("data-copy-loc"); try { if (navigator.clipboard) navigator.clipboard.writeText(locv); } catch (e2) {} cloc.classList.add("is-copied"); setTimeout(function () { cloc.classList.remove("is-copied"); }, 1200); toast("Copied " + locv, true); return; }
      var cai = e.target.closest("[data-crashai]");
      if (cai) { var caic = document.getElementById("crashai-" + cai.getAttribute("data-crashai")); if (caic) { caic.hidden = false; caic.classList.add("crashai--in"); } cai.setAttribute("hidden", ""); return; }
      var alp = e.target.closest("[data-analogpage]");
      if (alp && !alp.hasAttribute("disabled")) { anaLogPage = +alp.getAttribute("data-analogpage"); renderFailLogHost(); return; }
      var apg = e.target.closest("[data-anapage]");
      if (apg && !apg.hasAttribute("disabled")) { anaPage = +apg.getAttribute("data-anapage"); renderFailTableHost(); return; }
      var atype = e.target.closest("[data-anatype]");
      if (atype) { anaType = atype.getAttribute("data-anatype"); anaPage = 0;
        Array.prototype.forEach.call(document.querySelectorAll(".failseg [data-anatype]"), function (b) { b.setAttribute("appearance", b.getAttribute("data-anatype") === anaType ? "primary" : "subtle"); });
        renderFailTableHost(); return; }
      var asrt = e.target.closest("[data-anasort]");
      if (asrt) { var sk = asrt.getAttribute("data-anasort"); if (anaSort.key === sk) anaSort.dir = anaSort.dir === "asc" ? "desc" : "asc"; else { anaSort.key = sk; anaSort.dir = "desc"; } anaPage = 0; renderFailTableHost(); return; }
      var ssrt = e.target.closest("[data-symsort]");
      if (ssrt) { var ssk = ssrt.getAttribute("data-symsort"); if (symSort.key === ssk) symSort.dir = symSort.dir === "asc" ? "desc" : "asc"; else { symSort.key = ssk; symSort.dir = "desc"; } renderSymTableHost(); return; }
      var dvf = e.target.closest("[data-ver-filter]");
      if (dvf) { anaFilters.appver = [dvf.getAttribute("data-ver-filter")]; anaFailure = null; anaPage = 0; renderAnaFilter(); renderAnaChips(); renderAnalyticsPanel(); window.scrollTo(0, 0); return; }
      var dms = e.target.closest("[data-demostate]");
      if (dms) { anaDemoState = dms.getAttribute("data-demostate"); anaFailure = null; anaPage = 0; renderAnalyticsPanel(); return; }
      var crng = e.target.closest("[data-ca-range]");
      if (crng) { anaRange = crng.getAttribute("data-ca-range"); if (anaRange !== "custom") anaCustom = null; anaPage = 0; renderAnaFilter(); renderAnalyticsPanel(); return; }
      if (e.target.closest("[data-ca-apply]")) { var cf = $("caFrom"), ct = $("caTo"); applyCustomRange(cf && cf.value, ct && ct.value); renderAnaFilter(); renderAnalyticsPanel(); return; }
      var cscl = e.target.closest("[data-ca-scroll]");
      if (cscl) { var tgt = document.getElementById(cscl.getAttribute("data-ca-scroll")); if (tgt) tgt.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (e.target.closest("[data-ca-upload]")) { e.preventDefault(); var au = appById(analyticsAppId); if (au) openSymUploader(au, ""); return; }
      if (e.target.closest("[data-ca-filters]")) { openFilterFlyout(); return; }
      if (e.target.closest("[data-sym-history]")) { e.preventDefault(); var auh = appById(analyticsAppId); if (auh) openSymHistory(auh); return; }
      var chrm = e.target.closest("[data-chip-rm]"); if (chrm) { var pr = chrm.getAttribute("data-chip-rm").split("|"); removeFilter(pr[0], pr[1]); return; }
      if (e.target.closest("[data-filters-clear]")) { anaFilters = {}; renderAnaFilter(); renderAnaChips(); anaPage = 0; renderAnalyticsPanel(); return; }
      var su = e.target.closest("[data-sym-upload]");
      if (su) { var au2 = appById(analyticsAppId); if (au2) openSymUploader(au2, su.getAttribute("data-sym-upload")); return; }
      var sd = e.target.closest("[data-sym-details]");
      if (sd) { var au3 = appById(analyticsAppId); if (au3) openSymDetails(au3, sd.getAttribute("data-sym-details")); return; }
      var cst = e.target.closest("[data-copy-stack]");
      if (cst) { var ca = appById(analyticsAppId), cf = ca && anaData(ca).failures.filter(function (x) { return x.id === cst.getAttribute("data-copy-stack"); })[0]; if (cf) { try { if (navigator.clipboard) navigator.clipboard.writeText(stackTSV(ca, cf)); } catch (e3) {} toast("Stack trace copied", true); } return; }
      var dst = e.target.closest("[data-dl-stack]");
      if (dst) { var aa = appById(analyticsAppId), dd = aa && anaData(aa), fx = dd && dd.failures.filter(function (x) { return x.id === dst.getAttribute("data-dl-stack"); })[0];
        if (fx) { downloadText((dd.base || "crash") + "_" + fx.id + "_stack.txt", "Failure: " + fx.name + "\nException: " + fx.code + " (" + fx.type + ")\nVersion: " + fx.ver + "\nHits: " + fx.hits + "\n\n" + stackFrames(aa, fx).map(function (s, i) { return "  " + i + "  " + s; }).join("\n")); toast("Stack trace downloaded", true); } return; }
      var dsy = e.target.closest("[data-dl-sym]");
      if (dsy) { var aa2 = appById(analyticsAppId), dd2 = aa2 && anaData(aa2), he = dd2 && dd2.history.filter(function (x) { return x.id === dsy.getAttribute("data-dl-sym"); })[0];
        if (he) { downloadText(he.file + ".txt", "Symbol package: " + he.file + "\nVersion: " + he.ver + "\nUploaded by: " + he.by + " on " + he.date + "\nStatus: " + he.status + "\n\n(Demo placeholder \u2014 the original .zip would download here.)"); toast("Downloading " + he.file, true); } return; }
      var jump = e.target.closest("[data-jump]"); if (jump) { e.preventDefault(); goView(jump.getAttribute("data-jump")); }
    });

    var _symD = $("symDialog"); if (_symD) _symD.addEventListener("click", function (e) {
      if (e.target.closest("[data-sym-close]")) { closeSymUploader(); return; }
      if (e.target.closest("[data-noop]")) { e.preventDefault(); return; }
      if (e.target.closest("[data-sym-retry]")) { if (symUp) { symUp.phase = "pick"; renderSymUploader(); } return; }
      if (e.target.closest("[data-sym-start]")) { startSymValidate(); return; }
    });
    var _histD = $("histDialog"); if (_histD) _histD.addEventListener("click", function (e) {
      if (e.target.closest("[data-hist-close]")) { closeSymHistory(); return; }
      var dl = e.target.closest("[data-dl-sym]");
      if (dl) { var app = appById(analyticsAppId), he = app && anaData(app).history.filter(function (x) { return x.id === dl.getAttribute("data-dl-sym"); })[0];
        if (he) { downloadText(he.file + ".txt", "Symbol package: " + he.file + "\nVersion: " + he.ver + "\nUploaded by: " + he.by + " on " + he.date + "\nStatus: " + he.status + "\n\n(Demo placeholder \u2014 the original .zip would download here.)"); toast("Downloading " + he.file, true); } return; }
    });
    var _filtD = $("filterDrawer"); if (_filtD) _filtD.addEventListener("click", function (e) {
      if (e.target.closest("[data-filter-close]")) { closeFilterFlyout(); return; }
      if (e.target.closest("[data-filter-clearall]")) { clearFilterDrawer(); return; }
      if (e.target.closest("[data-filter-apply]")) { applyFiltersFromDrawer(); return; }
    });
    var occD = $("occDialog");
    if (occD) occD.addEventListener("click", function (e) {
      if (e.target.closest("[data-occ-close]")) { closeOccStack(); return; }
      var caiO = e.target.closest("[data-crashai-occ]");
      if (caiO) { var pO = document.getElementById("crashai-occ-" + caiO.getAttribute("data-crashai-occ")); if (pO) { pO.hidden = false; pO.classList.add("crashai--in"); } caiO.setAttribute("hidden", ""); return; }
      var cs = e.target.closest("[data-copy-stack]");
      if (cs) { var ca2 = appById(analyticsAppId), cf2 = ca2 && anaData(ca2).failures.filter(function (x) { return x.id === cs.getAttribute("data-copy-stack"); })[0]; if (cf2) { try { if (navigator.clipboard) navigator.clipboard.writeText(stackTSV(ca2, cf2)); } catch (e4) {} toast("Stack trace copied", true); } return; }
      var cl = e.target.closest("[data-copy-loc]");
      if (cl) { var lv = cl.getAttribute("data-copy-loc"); try { if (navigator.clipboard) navigator.clipboard.writeText(lv); } catch (e2) {} cl.classList.add("is-copied"); setTimeout(function () { cl.classList.remove("is-copied"); }, 1200); toast("Copied " + lv, true); return; }
      var dd = e.target.closest("[data-dl-dump]");
      if (dd) { var oa = appById(analyticsAppId), of = oa && anaData(oa).failures.filter(function (x) { return x.id === anaFailure; })[0]; if (of) { downloadText(of.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) + "_" + dd.getAttribute("data-dl-dump") + "_dump.txt", "Crash dump (demo placeholder)\nFailure: " + of.name + "\nOccurrence: " + dd.getAttribute("data-dl-dump") + "\n\n(The real .cab minidump would download here so you can debug locally.)"); toast("Downloading crash dump", true); } return; }
    });

    var _rs = $("resetState"); if (_rs) _rs.addEventListener("click", function (e) {
      e.preventDefault();
      if (confirm("Clear all certificates, apps, and verification state?")) {
        localStorage.removeItem(KEY); state = load(); save(); renderAll(); showSignin();
      }
    });

    wireNav();
  }

  /* ---------------- Sidebar view router ---------------- */
  // Promo codes + Customer groups are Store-portal-only views.
  var VIEWS = STORE
    ? ["overview", "apps", "certificates", "analytics", "promo-codes", "customer-groups"]
    : ["overview", "apps", "certificates", "analytics"];
  function showView(id) {
    if (VIEWS.indexOf(id) === -1) id = "overview";
    if (id === "promo-codes" && STORE && !hasLiveStoreApp()) id = "overview";   // Promo codes is gated until an app is live
    document.querySelectorAll(".main .block").forEach(function (b) { b.classList.toggle("active", b.id === id); });
    document.querySelectorAll(".snav a[data-nav]").forEach(function (l) { l.classList.toggle("is-active", l.getAttribute("href").slice(1) === id); });
    if (id === "analytics") renderAnalytics();
    else { var dsh0 = document.getElementById("demoSwitchHost"); if (dsh0) dsh0.innerHTML = ""; }
    window.scrollTo(0, 0);
  }
  function goView(id) { if (history.replaceState) history.replaceState(null, "", "#" + id); showView(id); }
  function wireNav() {
    document.querySelectorAll(".snav a[data-nav]").forEach(function (l) {
      l.addEventListener("click", function (e) { e.preventDefault(); goView(l.getAttribute("href").slice(1)); });
    });
    window.addEventListener("hashchange", function () { showView((location.hash || "").slice(1)); });
  }

  /* ---------------- View toggles + init ---------------- */
  function showApp() { $("signin").hidden = true; renderAll(); showView((location.hash || "").slice(1)); }
  function showSignin() { $("signin").hidden = false; }

  wire();
  renderAll();
  // Arriving from the marketing page (#signin) always shows the MSA sign-in first.
  if (location.hash === "#signin") { state.signedIn = false; save(); showSignin(); }
  else if (state.signedIn && state.account) {
    showApp();
    // WDP path: arriving from signup with a freshly-added certificate → scan + populate its
    // apps now, showing the portal's own "Scanning installed apps…" skeleton.
    if (!STORE && state.discoverCert && state.discoverCert.thumb) {
      var dc = state.discoverCert; delete state.discoverCert; save();
      discoverApps(dc.thumb, dc.certId);
    }
    // Store path: arriving from signup with a reserved app name → create it + open the
    // publishing flow (Back lands on the Apps page, per the portal's own flow).
    var cm = /[?&]create=([^&#]+)/.exec(location.search);
    if (cm) {
      var rsvName = decodeURIComponent(cm[1]);
      var lm = /[?&]lang=([^&#]+)/.exec(location.search);
      var rsvLang = lm ? decodeURIComponent(lm[1]) : "en-US";
      if (history.replaceState) history.replaceState(null, "", location.pathname + "#apps");
      setTimeout(function () {
        publishId = null;
        if ($("pubName")) $("pubName").value = rsvName;
        if ($("pubLang")) $("pubLang").value = rsvLang;
        doCreateApp();
      }, 60);
    }
  }
  else showSignin();
})();
