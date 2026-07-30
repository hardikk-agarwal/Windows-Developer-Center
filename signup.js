/* Windows Developer Program — developer enrollment journey.
   Phase 1 "Create developer account" has 4 sub-steps; for the demo we only show
   the account-type screen — Continue SKIPS the rest and marks them complete, then
   jumps to Phase 2 "Submit signed binary". The certificate step uses the REAL WDP
   portal verification logic: it generates an account-tied binary, posts the signed
   file to /api/verify-signature (Authenticode read), rejects unsigned/self-signed
   files, and shows the real signer subject / issuer / thumbprint / trust. On finish
   it seeds the portal with the real cert + verified=true. Demo only. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hashStr(s) { var h = 0, i; for (i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }
  function uid() { return "id-" + Math.abs(hashStr(String(Date.now()) + Math.random())).toString(36); }
  function initials(n) { var p = (n || "").trim().split(/\s+/);
    return (((p[0] || "")[0] || "") + ((p[1] || "")[0] || "") || "U").toUpperCase(); }
  async function sha256(file) {
    var buf = await file.arrayBuffer();
    var d = await crypto.subtle.digest("SHA-256", buf);
    return Array.prototype.map.call(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  function fmtThumb(hex) { var u = (hex || "").toUpperCase(); if (u.length < 12) return u; return u.slice(0, 16).match(/.{1,4}/g).join(" ") + " … " + u.slice(-4); }
  function fmtSize(n) { if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB"; if (n >= 1024) return (n / 1024).toFixed(0) + " KB"; return n + " B"; }
  function today() { return new Date().toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }); }
  function cnOf(subject) { if (!subject) return null; var m = /CN=([^,]+)/i.exec(subject); return m ? m[1].trim() : subject; }
  function trustPill(t) {
    if (t === "Valid") return '<span class="pill pill--ok pill--sm"><span class="verified-dot"></span>Valid</span>';
    if (t === "Offline") return '<span class="pill pill--ghost pill--sm">Hash only</span>';
    if (t === "NotSigned") return '<span class="pill pill--warn pill--sm">Unsigned</span>';
    return '<span class="pill pill--warn pill--sm">Untrusted</span>';
  }
  // A certificate whose issuer equals its subject is self-signed → not acceptable.
  function isSelfSigned(info) {
    if (!info || !info.signerThumbprint) return false;
    var s = (info.signerSubject || "").trim().toLowerCase();
    var iss = (info.issuer || "").trim().toLowerCase();
    return !!s && s === iss;
  }
  // Ask the local backend to read the real Authenticode signature; fall back to a
  // client-side SHA-256 fingerprint when the API is unreachable.
  async function inspectFile(file) {
    try {
      var res = await fetch("/api/verify-signature?name=" + encodeURIComponent(file.name), { method: "POST", body: file });
      if (!res.ok) throw new Error("api");
      var j = await res.json();
      if (j && j.error) throw new Error(j.error);
      j.offline = false; return j;
    } catch (e) { return { offline: true, status: "Offline", fileSha256: await sha256(file) }; }
  }
  function makeCert(info, file) {
    var thumb = info.signerThumbprint || info.fileSha256;
    return {
      id: uid(),
      label: cnOf(info.signerSubject) || file.name.replace(/\.[^.]+$/, ""),
      subject: info.signerSubject || null, issuer: info.issuer || null,
      thumb: thumb, thumbKind: info.signerThumbprint ? "cert" : "hash",
      trust: info.status || "Unknown", signed: !!info.signerThumbprint,
      notAfter: info.notAfter || null, added: today()
    };
  }

  var MSA = { name: "Alex Taylor", email: "alex.taylor@outlook.com", initials: "AT" };

  var PHASES = [
    { title: "Create developer account" }
  ];
  var STEPS = [
    { key: "account",  phase: 0, title: "Account type",
      head: "Choose your account type", headSub: "Tell us whether you're publishing as an individual or a company." },
    { key: "identity", phase: 0, title: "Identity verification" },
    { key: "profile",  phase: 0, title: "Profile details" },
    { key: "setup",    phase: 0, title: "Account setup" }
  ];
  function idxOf(key) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].key === key) return i; return -1; }

  var cur = 0, acctType = null, verifyPath = null, done = false;
  var downloaded = false, verifying = false;
  var pendingFile = null;     // the real File the user dropped/selected
  var verifyError = null;     // { name, reason } when a file is rejected
  var verifiedCert = null;    // the accepted certificate (real details)
  var store = { pubName: "", country: "United States", email: MSA.email };

  // In phase 2 only the chosen path's sub-step shows; before a choice, only "path".
  function stepVisible(i) {
    var k = STEPS[i].key;
    if (k === "verify") return verifyPath === "cert";
    if (k === "app") return verifyPath === "store";
    return true;
  }

  /* ---------- step rail (two phases, sub-steps nested) ---------- */
  function renderRail() {
    var html = "";
    for (var p = 0; p < PHASES.length; p++) {
      var idxs = []; for (var i = 0; i < STEPS.length; i++) if (STEPS[i].phase === p && stepVisible(i)) idxs.push(i);
      var first = idxs[0], last = idxs[idxs.length - 1];
      var pDone = done || cur > last, pActive = !done && cur >= first && cur <= last;
      var hCls = pDone ? "is-done" : pActive ? "is-active" : "";
      var num = pDone ? '<iconify-icon icon="fluent:checkmark-16-filled" width="16" height="16" aria-hidden="true"></iconify-icon>' : (p + 1);
      var subs = idxs.map(function (i) {
        var sDone = done || i < cur, sActive = !done && i === cur;
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

  // Phase 2 fork — selectable comparison (the two columns ARE the choice).
  function bodyPath() {
    function th(path, illo, rec, title, desc) {
      var sel = verifyPath === path;
      return '<div class="pcmp__th' + (path === "store" ? " pcmp__th--accent" : "") + (sel ? " is-selected" : "") +
        '" data-path="' + path + '" role="button" tabindex="0" aria-pressed="' + sel + '">' +
        '<span class="pcmp__badge">' + (rec ? '<span class="pcmp__rec">Recommended</span>' : "") + '</span>' +
        '<img data-theme-image="' + illo.replace(/\.png$/, '') + '" src="assets/' + illo + '" alt="" />' +
        '<strong>' + title + '</strong><span class="pcmp__desc">' + desc + '</span>' +
        '<span class="pcmp__select"><span class="pcmp__radio"></span>' + (sel ? "Selected" : "Select") + '</span></div>';
    }
    function mark(on) {
      return on
        ? '<iconify-icon class="pcmp-yes" icon="fluent:checkmark-circle-16-filled" width="18" height="18" aria-hidden="true"></iconify-icon>'
        : '<span class="pcmp-no" aria-label="Not included">—</span>';
    }
    function row(label, s, c) {
      // Columns: label | Verify with a certificate (c) | Publish to the Store (s)
      return '<div class="pcmp__feat">' + label + '</div>' +
        '<div class="pcmp__val">' + mark(c) + '</div>' +
        '<div class="pcmp__val">' + mark(s) + '</div>';
    }
    return '<div class="pcmp">' +
      '<div class="pcmp__corner"><strong>Pick your path</strong><small>Click a column to select it, then Continue.</small></div>' +
      th("cert", "shield-checkmark.png", false, "Verify with a certificate", "Submit a signed binary, your own way") +
      th("store", "rocket.png", true, "Publish to the Store", "Reach millions — the complete benefit set") +
      row("Publisher identity &amp; recognition", true, true) +
      row("Frictionless installs (no SmartScreen)", true, true) +
      row("Crash &amp; health analytics", true, true) +
      row("Package signing", true, false) +
      row("Hosting &amp; delivery", true, false) +
      row("Distribute on your own", true, true) +
      row("Reach millions of Store shoppers", true, false) +
      row("Rich analytics — acquisitions, installs &amp; usage", true, false) +
      row("Ratings, reviews &amp; engagement", true, false) +
      row("Commerce, payments &amp; payouts", true, false) +
      '</div>';
  }

  // Phase 2 (Store path) — nudge to create the first app; same hand-off as the Store signup.
  function bodyStoreApp() {
    return '<div class="status-card wiz-hero">' +
      '<img class="status-card__illo" data-theme-image="rocket" src="assets/rocket.png" alt="" />' +
      '<div class="status-card__body">' +
        '<span class="pill pill--ok"><span class="verified-dot"></span>Microsoft Store developer</span>' +
        '<h2>Bring your app to the Store</h2>' +
        '<p class="muted">Your developer account is active. Create your first app and reach over a billion Windows devices — the complete benefit set comes built in.</p>' +
      '</div>' +
      '<div class="status-card__action wiz-actions">' +
        '<fluent-button appearance="primary" id="goCreate"><iconify-icon slot="start" icon="fluent:add-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon>Create your first app</fluent-button>' +
        '<fluent-button appearance="outline" id="goPortal">Go to developer portal</fluent-button>' +
      '</div>' +
    '</div>' + storePerksHTML();
  }
  function storePerksHTML() {
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

  function dropzoneHTML() {
    var zone = pendingFile
      ? '<div class="dropzone__file">' +
          '<span class="dropzone__fileico"><iconify-icon icon="fluent:document-checkmark-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon></span>' +
          '<span class="dropzone__filemeta"><strong>' + esc(pendingFile.name) + '</strong><span class="muted">' + fmtSize(pendingFile.size) + '</span></span>' +
          '<button type="button" class="dropzone__clear" id="binClear" aria-label="Remove file">✕</button>' +
        '</div>'
      : '<div class="dropzone__prompt">' +
          '<iconify-icon icon="fluent:arrow-upload-20-regular" width="26" height="26" aria-hidden="true"></iconify-icon>' +
          '<span><strong>Drop signed binary</strong> or click to browse</span>' +
          '<span class="dropzone__hint">.exe · .dll · .msix · .appx · .bin</span>' +
        '</div>';
    return '<input type="file" id="binInput" accept=".exe,.dll,.msix,.appx,.msi,.bin,.cer,.crt,.pem,.der" hidden />' +
      '<div class="dropzone' + (pendingFile ? " has-file" : "") + '" id="binDrop" role="button" tabindex="0" aria-label="Upload signed binary">' +
        zone + '<div class="dropzone__bar" id="binBar" hidden></div></div>';
  }

  function errorHTML() {
    if (!verifyError) return "";
    return '<div class="msgbar msgbar--error">' +
      '<iconify-icon class="msgbar__icon" icon="fluent:error-circle-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon>' +
      '<div class="msgbar__content"><strong>We couldn’t verify ' + esc(verifyError.name) + '</strong><p>' + esc(verifyError.reason) + '</p></div>' +
      '<button type="button" class="msgbar__dismiss" id="binErrDismiss" aria-label="Dismiss">✕</button>' +
    '</div>';
  }

  // Reuses the WDP portal "Verify your certificate" UI: steps 1 & 2 side by side,
  // step 3 (submit the signed file) full-width below.
  function bodyVerify() {
    return '<div class="wiz-verify">' +
      '<div class="hsteps">' +
        '<div class="hstep">' +
          '<div class="hstep__num">1</div>' +
          '<h3>Download the binary</h3>' +
          '<p class="muted">A unique binary tied to your account — download this exact file to sign.</p>' +
          '<fluent-button appearance="' + (downloaded ? "subtle" : "outline") + '" id="binDownload" class="js-download">' +
            '<iconify-icon slot="start" icon="' + (downloaded ? "fluent:checkmark-circle-20-filled" : "fluent:arrow-download-20-regular") + '" width="18" height="18" aria-hidden="true"></iconify-icon>' +
            (downloaded ? "Downloaded" : "Download binary") + '</fluent-button>' +
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
        '<p class="muted">Drop it below to join the program.</p>' +
        dropzoneHTML() + errorHTML() +
        '<div class="submit-row"><fluent-button appearance="primary" id="binSubmit"' + (pendingFile ? "" : " disabled") + '>Join the program</fluent-button></div>' +
      '</div>' +
      '<div class="wiz-laterbar">' +
        '<iconify-icon icon="fluent:clock-20-regular" width="22" height="22" aria-hidden="true"></iconify-icon>' +
        '<div class="wiz-laterbar__text"><strong>Prefer to sign on your own time?</strong>' +
          '<span>Download your binary now, then upload your signed file anytime from your WDP portal — your account stays ready whenever you are.</span></div>' +
        '<fluent-button appearance="outline" id="goLater">Go to portal</fluent-button>' +
      '</div>' +
    '</div>';
  }

  function certDetail(c) {
    function row(k, v) { return '<div class="rev__row"><span>' + k + '</span><strong>' + v + '</strong></div>'; }
    var expires = "—";
    if (c.notAfter) { var d = new Date(c.notAfter); if (!isNaN(d)) expires = d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }); }
    return '<div class="rev">' +
      row("Certificate", esc(c.label || "—")) +
      (c.issuer ? row("Issued by", esc(cnOf(c.issuer) || c.issuer)) : "") +
      '<div class="rev__row"><span>Thumbprint</span><strong class="mono">' + esc(fmtThumb(c.thumb)) + '</strong></div>' +
      '<div class="rev__row"><span>Status</span>' + trustPill(c.trust) + '</div>' +
      row("Expires", expires) +
      '</div>';
  }

  // Completion = the portal's hero status-card banner + the accepted certificate.
  function bodyDone() {
    return '<div class="status-card wiz-hero">' +
      '<img class="status-card__illo" data-theme-image="badge" src="assets/badge.png" alt="" />' +
      '<div class="status-card__body">' +
        '<span class="pill pill--ok"><span class="verified-dot"></span>Account created</span>' +
        '<h2>Your developer account is ready</h2>' +
        '<p class="muted">Your account is set up. Continue to your developer portal to publish apps, add a signing certificate, and track your app health.</p>' +
      '</div>' +
      '<div class="status-card__action">' +
        '<fluent-button appearance="primary" size="large" id="goPortal"><iconify-icon slot="start" icon="fluent:open-20-regular" width="18" height="18" aria-hidden="true"></iconify-icon>Continue to developer portal</fluent-button>' +
      '</div>' +
    '</div>' +
    perksHTML();
  }
  function perksHTML() {
    function item(icon, title, desc) {
      return '<div class="wiz-next__item">' +
        '<iconify-icon icon="' + icon + '" width="22" height="22" aria-hidden="true"></iconify-icon>' +
        '<div><strong>' + title + '</strong><span>' + desc + '</span></div></div>';
    }
    return '<div class="wiz-next">' +
      '<p class="wiz-next__lead">In your developer portal:</p>' +
      '<div class="wiz-next__grid">' +
        item("fluent:data-trending-20-regular", "Crash analytics", "You can monitor crashes and app health.") +
        item("fluent:share-20-regular", "Distribution control", "You can control where your apps are distributed.") +
        item("fluent:certificate-20-regular", "Certificates", "You can add and manage signing certificates.") +
      '</div></div>';
  }

  /* ---------- render ---------- */
  function render() {
    renderRail();
    if (done) {
      $("wizTitle").textContent = "Your developer account is ready";
      $("wizSub").textContent = "Your account is created. Continue to your developer portal to get started.";
      $("wizBody").innerHTML = bodyDone();
      $("wizFootbar").innerHTML = "";
      wireDone();
      return;
    }
    var s = STEPS[cur], k = s.key;
    $("wizTitle").textContent = s.head;
    $("wizSub").textContent = s.headSub;
    $("wizBody").innerHTML = k === "account" ? bodyAccount()
      : k === "path" ? bodyPath()
      : k === "app" ? bodyStoreApp()
      : bodyVerify();
    if (k === "account" || k === "path") {
      var ready = k === "account" ? acctType : verifyPath;
      $("wizFootbar").innerHTML = '<span></span>' +
        '<fluent-button appearance="primary" id="wizNext"' + (ready ? "" : " disabled") + '>Continue</fluent-button>';
    } else {
      $("wizFootbar").innerHTML = "";
    }
    wireStep();
  }

  // Demo: skip the account-creation sub-steps; account → path fork → chosen branch.
  function next() {
    var k = STEPS[cur].key;
    if (k === "account") { if (!acctType) return; done = true; render(); window.scrollTo(0, 0); return; }
  }

  // Generate the account-tied verification binary (same as the portal's download).
  function downloadBinary() {
    var nonce = Math.abs(hashStr((store.email || "x") + Date.now())).toString(16);
    var blob = new Blob(["WDP-VERIFICATION-BINARY\naccount: " + (store.email || "") + "\nnonce: " + nonce + "\n"], { type: "application/octet-stream" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "wdp-verification.bin"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    downloaded = true; render();
  }

  // Real verification: read the Authenticode signature, reject unsigned/self-signed.
  async function verifyFile() {
    if (!pendingFile || verifying) return;
    verifying = true; verifyError = null;
    var sb = $("binSubmit"); if (sb) { sb.setAttribute("disabled", ""); sb.innerHTML = '<span class="spinner"></span>Verifying…'; }
    var dz = $("binDrop"); if (dz) dz.classList.add("is-verifying");
    var bar = $("binBar"); if (bar) bar.hidden = false;
    var file = pendingFile, info = await inspectFile(file);
    verifying = false;
    if (!info.offline && info.kind === "authenticode" && !info.signerThumbprint) {
      verifyError = { name: file.name, reason: "This file isn’t signed. Sign it with a certificate from a trusted Certificate Authority (CA)." };
      render(); return;
    }
    if (!info.offline && isSelfSigned(info)) {
      verifyError = { name: file.name, reason: "The certificate is self-signed, not issued by a trusted Certificate Authority (CA). Use a CA-issued code signing certificate." };
      render(); return;
    }
    verifiedCert = makeCert(info, file);
    done = true; render(); window.scrollTo(0, 0);
  }

  function wireStep() {
    var nb = $("wizNext"); if (nb) nb.addEventListener("click", next);
    var k = STEPS[cur].key;
    if (k === "account") {
      $("wizBody").querySelectorAll("[data-acct]").forEach(function (el) {
        function pick() { acctType = el.getAttribute("data-acct"); render(); }
        el.addEventListener("click", pick);
        el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      });
    } else if (k === "path") {
      $("wizBody").querySelectorAll("[data-path]").forEach(function (el) {
        function pick() { verifyPath = el.getAttribute("data-path"); render(); }
        el.addEventListener("click", pick);
        el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      });
    } else if (k === "app") {
      var gc = $("goCreate"); if (gc) gc.addEventListener("click", openReserve);
      var gp = $("goPortal"); if (gp) gp.addEventListener("click", function () { seedStorePortal(); location.href = "store-portal.html#apps"; });
    } else {
      wireVerify();
    }
  }
  function wireVerify() {
    var dl = $("binDownload"); if (dl) dl.addEventListener("click", downloadBinary);
    var input = $("binInput"), dz = $("binDrop");
    function take(files) { if (files && files.length) { pendingFile = files[0]; verifyError = null; render(); } }
    if (input) input.addEventListener("change", function () { take(input.files); input.value = ""; });
    if (dz) {
      dz.addEventListener("click", function (e) { if (e.target.closest("#binClear")) return; if (input) input.click(); });
      dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (input) input.click(); } });
      ["dragover", "dragenter"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-over"); }); });
      dz.addEventListener("drop", function (e) { take(e.dataTransfer.files); });
    }
    var clr = $("binClear");
    if (clr) clr.addEventListener("click", function (e) { e.stopPropagation(); if (verifying) return; pendingFile = null; verifyError = null; render(); });
    var dis = $("binErrDismiss");
    if (dis) dis.addEventListener("click", function () { verifyError = null; render(); });
    var sb = $("binSubmit"); if (sb) sb.addEventListener("click", verifyFile);
    // "Verify later" — go to the portal account-created but not yet verified; the same
    // download→sign→upload flow waits there (seedPortal with no cert keeps verified=false).
    var later = $("goLater"); if (later) later.addEventListener("click", function () { seedPortal(); location.href = "portal.html"; });
  }
  // Where the developer came from decides the landing page. WDP marketing -> the WDP portal's
  // Certificates page (add a signing certificate next). Store -> the Store portal's Apps page.
  // Otherwise -> the developer portal overview.
  function portalSource() {
    var q = location.search || "", r = document.referrer || "";
    if (/[?&]from=store\b/.test(q) || r.indexOf("store-developer") >= 0) return "store";
    if (/[?&]from=wdp\b/.test(q) || r.indexOf("wdp-marketing") >= 0) return "wdp";
    return "";
  }
  function wireDone() {
    // Open the portal instantly; it scans + populates this cert's apps on load (its own skeleton).
    var gp = $("goPortal");
    if (gp) gp.addEventListener("click", function () {
      var src = portalSource();
      if (src === "store") { seedStorePortal(); location.href = "store-portal.html#apps"; return; }
      seedPortal();
      location.href = src === "wdp" ? "portal.html#certificates" : "portal.html";
    });
  }

  // Land in the WDP portal already signed in. A freshly-created account starts from a
  // CLEAN slate (overwrite, don't merge) so any earlier demo state can't leak in:
  //  • "Go to portal" without submitting a binary → zero state, verified=false, no certs.
  //  • After verifying a cert → that cert (the portal scans + populates its apps on load), verified=true.
  function seedPortal() {
    try {
      var KEY = "tdp.portal.v5";
      var s = {
        signedIn: true,
        account: { name: store.pubName || MSA.name, email: store.email || MSA.email, initials: initials(store.pubName || MSA.name) },
        verified: false, certs: [], apps: []
      };
      if (verifiedCert) {
        s.certs.push(verifiedCert);
        s.verified = true;
        // Let the WDP portal scan + populate this cert's apps on load (shows its own skeleton).
        if (verifiedCert.thumbKind === "cert") s.discoverCert = { thumb: verifiedCert.thumb, certId: verifiedCert.id };
      }
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {}
  }

  // Store path: land in the Store portal already signed in, on the Apps page. Fresh account
  // → clean slate (overwrite, don't merge) so no earlier demo apps leak into the zero state.
  function seedStorePortal() {
    try {
      var KEY = "tdp.portal.store.v1";
      var s = { signedIn: true, verified: true, certs: [], apps: [] };
      s.account = { name: store.pubName || MSA.name, email: store.email || MSA.email, initials: initials(store.pubName || MSA.name) };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {}
  }

  /* ---------- reserve-name dialog (Store path; same dialog as the Store portal) ---------- */
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
  // opens the publishing flow.
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

  // Deep-link from an external account picker (e.g. the Partner Center Insights migration flow):
  // the user has ALREADY chosen an account there, so skip this page's own MSA sign-in and go
  // straight to enrollment — no second sign-in. Optional name/email carry the chosen identity.
  var q = location.search;
  if (/[?&](signedin=1|from=insights)\b/.test(q)) {
    var nmM = /[?&]name=([^&#]+)/.exec(q), emM = /[?&]email=([^&#]+)/.exec(q);
    if (nmM) { MSA.name = decodeURIComponent(nmM[1]); MSA.initials = initials(MSA.name); }
    if (emM) { MSA.email = decodeURIComponent(emM[1]); store.email = MSA.email; }
    var av = $("hdrAvatar");
    if (av && nmM) { av.textContent = MSA.initials; av.setAttribute("title", MSA.name); av.setAttribute("aria-label", MSA.name); }
    showWiz();
  }
})();
