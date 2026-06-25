/* Windows Developer Portal — data-driven, persisted to localStorage.
   The ONLY mock element is the demo MSA sign-in account.

   Unified flow: "Add certificate" submits one or more signed binaries. The real
   Authenticode signer (via the local backend) is attached as a certificate. The
   submitted binary only PROVES the certificate — it is not itself listed as an
   app. Apps are then discovered from this PC: the real installed apps signed by
   that certificate are auto-populated under it (one cert → all its apps). */
(function () {
  "use strict";

  var KEY = "tdp.portal.v5";
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
  function cnOf(subject) { if (!subject) return null; var m = /CN=([^,]+)/i.exec(subject); return m ? m[1].trim() : subject; }
  function certById(id) { return state.certs.filter(function (c) { return c.id === id; })[0] || null; }
  function trustWord(s) { return s === "Valid" ? "verified" : s === "NotSigned" ? "unsigned" : "self-signed (not yet verified)"; }
  function trustPill(t) {
    if (t === "Valid") return '<span class="pill pill--ok pill--sm">Valid</span>';
    if (t === "Offline") return '<span class="pill pill--ghost pill--sm">Hash only</span>';
    if (t === "NotSigned") return '<span class="pill pill--warn pill--sm">Unsigned</span>';
    return '<span class="pill pill--warn pill--sm">Unverified</span>';
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
    renderAccount(); renderStatus(); renderCerts(); renderApps(); renderAnalytics(); renderSummary();
  }

  function renderAccount() {
    var a = state.account || { name: "Your organization", initials: "—" };
    $("avatar").textContent = a.initials;
    $("accountName").textContent = a.name;
    $("accountStatus").innerHTML = !state.verified
      ? '<span class="verified-dot verified-dot--off"></span>Not verified'
      : (hasValidCert()
          ? '<span class="verified-dot"></span>Verified Developer'
          : '<span class="verified-dot verified-dot--warn"></span>Identity verified');
  }

  function renderStatus() {
    var el = $("statusCard");
    var allowed = distributingCount();
    var inStore = state.apps.filter(function (x) { return x.store; }).length;
    if (!state.verified) {
      el.innerHTML =
        '<div class="status-card status-card--off status-card--solo">' +
          '<img class="status-card__illo" src="assets/trust.png" alt="" />' +
          '<div class="status-card__body">' +
            '<span class="pill pill--warn">Not verified</span>' +
            '<h2>Get verified on Windows</h2>' +
            '<p class="muted">Prove you own a code signing certificate to become a verified developer.</p>' +
          '</div>' +
        '</div>';
      return;
    }
    var valid = hasValidCert();
    var pill = valid
      ? '<span class="pill pill--ok"><span class="verified-dot"></span>Verified Developer</span>'
      : '<span class="pill pill--warn">Identity verified · certificate not verified</span>';
    var head = valid ? esc(state.account.name) + " is verified on Windows"
                     : esc(state.account.name) + "’s identity is verified";
    var body = valid
      ? "Your identity and code signing certificate are verified. Apps you sign install without SmartScreen interruptions and have crash analytics unlocked."
      : "Your <strong>identity</strong> is verified, but your certificate is self-signed and not chain-trusted by Windows — installs may still show SmartScreen. Use a CA-issued code signing certificate for frictionless installs.";
    el.innerHTML =
      '<div class="status-card status-card--hero' + (valid ? '' : ' status-card--off') + '">' +
        '<div class="status-card__top">' +
          '<img class="status-card__illo" src="assets/' + (valid ? 'shield-person' : 'trust') + '.png" alt="" />' +
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

  function renderSummary() {
    var el = $("overviewSummary");
    if (!el) return;
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
        '<p class="muted">Drop it below to get verified.</p>' +
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
        '<h3>Submit the signed file</h3><p class="muted">Drop it below to get verified.</p>' + dz + list + err +
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
        if (lastCert && lastCert.thumbKind === "cert") discoverApps(lastCert.thumb, lastCert.id);
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
    var body = $("certBody");
    if (!state.certs.length) {
      body.innerHTML = '<tr><td colspan="6" class="cellspan">No certificates yet — ' +
        '<a class="linkbtn" data-openmodal>add a certificate</a> by submitting a signed binary.</td></tr>';
      return;
    }
    body.innerHTML = state.certs.map(function (c) {
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
    }).join("");
  }

  function appSkeletonHTML(n) {
    var one = '<div class="appcard appcard--sk"><div class="sk sk--icon"></div>' +
      '<div class="sk-lines"><div class="sk sk--line"></div><div class="sk sk--line sk--short"></div></div></div>';
    var s = ""; for (var i = 0; i < n; i++) s += one; return s;
  }
  // Once any app is published, the header's primary CTA becomes "Create new app".
  function updateAppsHeader() {
    var published = state.apps.some(function (a) { return a.store; });
    var createBtn = $("createAppBtn"), addCert = $("addCertBtn");
    if (createBtn) createBtn.hidden = !published;
    if (addCert) addCert.setAttribute("appearance", published ? "outline" : "primary");
  }
  function renderApps() {
    updateAppsHeader();
    var wrap = $("appsList");
    var banner = scanning
      ? '<div class="scan-banner"><span class="spinner"></span>Scanning installed apps signed by your certificate…</div>'
      : "";
    var sk = scanning ? appSkeletonHTML(3) : "";
    if (!state.apps.length) {
      wrap.innerHTML = scanning ? (banner + sk) : ('<div class="empty">' +
        '<img src="assets/rocket.png" alt="" />' +
        '<strong>No apps yet</strong>' +
        '<p class="muted">Apps signed by your certificates are discovered automatically. Add a ' +
          'certificate and any app installed on this PC that uses it appears here.</p>' +
        '<fluent-button appearance="primary" data-openmodal>Add certificate</fluent-button>' +
      '</div>');
      return;
    }
    // Group apps by the certificate that signs them. Signing identity + trust are a
    // property of the CERTIFICATE, so they show once per group — not on every app.
    var groups = [], byKey = {};
    state.apps.forEach(function (a) {
      var key = a.certId || (a.signerSubject ? "subj:" + a.signerSubject : "none");
      if (!byKey[key]) { byKey[key] = { certId: a.certId, subject: a.signerSubject, apps: [] }; groups.push(byKey[key]); }
      byKey[key].apps.push(a);
    });
    wrap.innerHTML = banner + groups.map(certGroupHTML).join("") + (scanning ? appSkeletonHTML(2) : "");
  }

  // One certificate → one header (signer + trust, shown once) → a table of its apps.
  function certGroupHTML(g) {
    var cert = certById(g.certId), ico, label, pill;
    if (cert) {
      ico = '<span class="cert-ico' + (cert.signed ? "" : " cert-ico--alt") + '">' + (cert.signed ? "CS" : "#") + '</span>';
      label = esc(cert.label);
      pill = cert.trust === "Valid"
        ? '<span class="pill pill--ok pill--sm"><span class="verified-dot"></span>Verified</span>'
        : '<span class="pill pill--warn pill--sm">Cert not verified</span>';
    } else if (g.subject) {
      ico = '<span class="cert-ico cert-ico--alt">?</span>';
      label = esc(cnOf(g.subject));
      pill = '<span class="pill pill--warn pill--sm">Unidentified cert</span>';
    } else {
      ico = '<span class="cert-ico cert-ico--alt">#</span>';
      label = "No certificate";
      pill = '<span class="pill pill--warn pill--sm">Unsigned</span>';
    }
    var n = g.apps.length;
    var thumb = cert ? ' · <span class="mono">' + fmtThumb(cert.thumb) + '</span>' : "";
    return '<section class="certgroup">' +
      '<header class="certgroup__head">' + ico +
        '<div class="certgroup__id">' +
          '<div class="certgroup__name">Signed by <strong>' + label + '</strong>' + pill + '</div>' +
          '<span class="certgroup__meta">' + n + ' app' + (n > 1 ? "s" : "") + thumb + '</span>' +
        '</div>' +
      '</header>' +
      '<div class="table-wrap"><table class="table apptable">' +
        '<thead><tr><th>App</th><th>Crash analytics</th><th>Download sources</th><th class="col-store">Store</th></tr></thead>' +
        '<tbody>' + g.apps.map(appRowHTML).join("") + '</tbody>' +
      '</table></div>' +
    '</section>';
  }

  function appRowHTML(a) {
    var iconHTML = a.icon
      ? '<span class="app-ico app-ico--img"><img src="data:image/png;base64,' + a.icon + '" alt="" /></span>'
      : '<span class="app-ico" style="background:linear-gradient(135deg,' + colorFor(a.name) + ',#0b2a4a)">' + esc(initials(a.name)) + '</span>';
    var created = a.store || a.storeStatus === "in-progress";
    var store = a.store
      ? '<span class="pill pill--ok pill--sm">✓ In Microsoft Store</span>'
      : created
        ? '<fluent-button appearance="outline" size="small" data-continue="' + a.id + '">Continue setup</fluent-button>'
        : '<fluent-button appearance="primary" size="small" data-store="' + a.id + '">Publish to Store</fluent-button>';
    return '<tr' + (created ? ' class="approw--open" data-openapp="' + a.id + '" title="Open publishing flow"' : '') + '>' +
      '<td><div class="cell-main">' + iconHTML +
        '<div><strong>' + esc(a.name) + '</strong>' + (a.size ? '<span class="muted">' + esc(a.size) + '</span>' : '') + '</div></div></td>' +
      '<td><button class="health" data-analytics="' + a.id + '" data-health="' + a.id + '" title="View crash analytics">' + healthCellInner(a) + '</button></td>' +
      '<td><div class="srccell"><span class="src-summary">' + srcSummary(a) + '</span>' +
        '<button class="linkbtn" data-sources="' + a.id + '">Manage</button></div></td>' +
      '<td class="col-store">' + store + '</td>' +
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
  // Crash Health is available for every verified app; the Store analytics (acquisition,
  // usage, ratings) are LOCKED until the app is published to the Microsoft Store.
  var ANA_TABS = [
    { key: "crashes",     label: "Health",            icon: "fluent:bug-20-regular", free: true },
    { key: "acquisition", label: "Acquisition",       icon: "fluent:arrow-download-20-regular" },
    { key: "usage",       label: "Usage",             icon: "fluent:pulse-20-regular" },
    { key: "ratings",     label: "Ratings & reviews", icon: "fluent:star-20-regular" }
  ];

  function emptyAnalyticsHTML() {
    return '<div class="empty"><img src="assets/data-trending.png" alt="" />' +
      '<strong>Analytics unlocked</strong>' +
      '<p class="muted">Add a certificate so your apps appear here, then explore crashes, ' +
      'acquisition, usage, ratings and performance.</p></div>';
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
  function anaData(app) {
    if (anaCache[app.id]) return anaCache[app.id];
    var rnd = anaRng(Math.abs(hashStr(app.id + "|" + app.name)) || 1);
    var exe = app.file || (app.name.replace(/\s+/g, "") + ".exe");
    var crashes = Math.round(8e5 + rnd() * 4e6), hangs = Math.round(1e6 + rnd() * 3e6), crashRate = +(2 + rnd() * 5).toFixed(2);
    var days = 28, labels = [];
    for (var i = 0; i < days; i++) { var dm = 18 + i; labels.push(dm > 31 ? dm - 31 : dm); }
    var series = [
      { name: "Crashes", color: "var(--brand)", values: wave(rnd, days, crashes / days * 9, crashes / days * 5).map(Math.round) },
      { name: "Hangs", color: "#C239B3", values: wave(rnd, days, hangs / days * 2.6, hangs / days).map(Math.round) },
      { name: "Memory failures", color: "#8661C5", values: wave(rnd, days, crashes / days * 0.5, crashes / days * 0.4).map(Math.round) }
    ];
    var dist = [], dv = 1.1e6 + rnd() * 4e5;
    for (var v = 0; v < 10; v++) { dist.push({ label: "6.1." + (8 + ((rnd() * 6) | 0)) + ".0", value: Math.round(dv) }); dv *= (0.32 + rnd() * 0.4); }
    var failures = [], share = 0.5;
    for (var f = 0; f < 24; f++) {
      var k = FAIL_KINDS[f % FAIL_KINDS.length];
      failures.push({ id: "f" + f, name: k.p + hexTok(rnd, 8) + "_" + exe.replace(/\.exe$/i, "") + ".exe" + k.s, type: k.t, hits: Math.max(2000, Math.round((crashes + hangs) * share * (0.7 + rnd() * 0.5))) });
      share *= (0.55 + rnd() * 0.3);
    }
    var sum = failures.reduce(function (m, x) { return m + x.hits; }, 0);
    failures.forEach(function (x) { x.pct = +(x.hits / sum * 100).toFixed(2); });
    failures.sort(function (a, b) { return b.hits - a.hits; });
    return (anaCache[app.id] = { crashes: crashes, hangs: hangs, crashRate: crashRate, hits: { labels: labels, series: series }, dist: dist, failures: failures });
  }
  function failureDetail(app, f) {
    var rnd = anaRng(Math.abs(hashStr(app.id + "|" + f.id)) || 1), days = 28, labels = [];
    for (var i = 0; i < days; i++) { var dm = 18 + i; labels.push(dm > 31 ? dm - 31 : dm); }
    var series = [{ name: f.type + "s", color: "var(--brand)", values: wave(rnd, days, f.hits / days * 6, f.hits / days * 3).map(Math.round) }];
    var log = [];
    for (var r = 0; r < 8; r++) log.push({ date: "05/" + pad2(17 - ((rnd() * 6) | 0)) + "/2026 " + pad2(1 + ((rnd() * 9) | 0)) + ":" + pad2((rnd() * 59) | 0) + " AM", ver: "6.1." + (8 + ((rnd() * 6) | 0)) + ".0", dev: "PC", model: pick(rnd, DEV_MODELS), os: pick(rnd, OS_BUILDS) });
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
  function anaTabsHTML() {
    return '<div class="anatabs" role="tablist">' + ANA_TABS.map(function (t) {
      return '<button class="anatab' + (t.key === anaTab ? " is-active" : "") + '" data-anatab="' + t.key + '" role="tab">' +
        '<iconify-icon icon="' + t.icon + '" width="18" height="18" aria-hidden="true"></iconify-icon>' + esc(t.label) + '</button>';
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
  function crashTab(app) {
    var d = anaData(app);
    if (anaFailure) return failureView(app, d);
    var h = healthExtra(app, d), rateFmt = function (v) { return v.toFixed(2); };
    var cards = '<div class="sumrow sumrow--4">' +
      sumCard("Crashes", fmtCompact(d.crashes), "Last 30 days", d.hits.series[0].values, "var(--brand)") +
      sumCard("Hangs", fmtCompact(d.hangs), "Last 30 days", d.hits.series[1].values, "#C239B3") +
      sumCard("Crash rate", h.crashRate.toFixed(3) + "%", "Last 30 days", h.crashRateSeries, "#5ad1cd") +
      sumCard("Hang rate", h.hangRate.toFixed(3) + "%", "Last 30 days", h.hangRateSeries, "#f7b955") + '</div>';
    return cards +
      apanel("Failure count", chartLine({ series: d.hits.series, labels: d.hits.labels, area: true }) + chartLegend(d.hits.series)) +
      apanel("Failure rate", chartLine({ series: [{ name: "Crash rate", color: "var(--brand)", values: h.crashRateSeries }, { name: "Hang rate", color: "#e3008c", values: h.hangRateSeries }], labels: d.hits.labels, yMin: 0, yMax: 0.15, fmt: rateFmt }) + legendDots([{ name: "Crash rate", color: "var(--brand)" }, { name: "Hang rate", color: "#e3008c" }])) +
      apanel("Failure distribution", chartBars({ bars: d.dist }), "Crashes by app version") +
      apanel("Failures", failuresTable(app, d)) +
      '<div class="apanel-grid">' +
        apanel("Package version", hitsTable("Package version", h.pkgVer.map(function (r) { return { label: r.ver, hits: r.hits, pct: r.pct }; }))) +
        apanel("Geographical Failure Hits", hitsTable("Country/region", h.geo.map(function (r) { return { label: r.country, hits: r.hits, pct: r.pct }; }))) +
      '</div>';
  }
  function failuresTable(app, d) {
    var per = 6, pages = Math.ceil(d.failures.length / per), pg = Math.max(0, Math.min(anaPage, pages - 1));
    var rows = d.failures.slice(pg * per, pg * per + per).map(function (f) {
      return '<tr class="failrow" data-failure="' + f.id + '"><td><span class="faillink">' + esc(f.name) + '</span></td>' +
        '<td class="num">' + fmtComma(f.hits) + '</td><td class="num">' + f.pct.toFixed(2) + '%</td></tr>';
    }).join("");
    return '<div class="table-wrap"><table class="atable"><thead><tr><th>Failure name</th><th class="num">Hits</th><th class="num">Percentage</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="apager"><button class="apager__b" data-anapage="' + (pg - 1) + '"' + (pg <= 0 ? " disabled" : "") + ' aria-label="Previous"><iconify-icon icon="fluent:chevron-left-20-regular" width="16" height="16"></iconify-icon></button>' +
      '<span class="muted">Page ' + (pg + 1) + ' of ' + pages + '</span>' +
      '<button class="apager__b" data-anapage="' + (pg + 1) + '"' + (pg >= pages - 1 ? " disabled" : "") + ' aria-label="Next"><iconify-icon icon="fluent:chevron-right-20-regular" width="16" height="16"></iconify-icon></button></div>';
  }
  function failureView(app, d) {
    var f = d.failures.filter(function (x) { return x.id === anaFailure; })[0];
    if (!f) { anaFailure = null; return crashTab(app); }
    var det = failureDetail(app, f);
    var logRows = det.log.map(function (r) {
      return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.ver) + '</td><td>' + esc(r.dev) + '</td><td>' + esc(r.model) + '</td><td>' + esc(r.os) + '</td><td><span class="faillink">Stack trace</span></td></tr>';
    }).join("");
    var cpuRows = det.cpu.map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td class="num">' + c[1].toFixed(1) + '%</td></tr>'; }).join("");
    return '<button class="aback" data-anaback="1"><iconify-icon icon="fluent:chevron-left-20-regular" width="18" height="18"></iconify-icon>Back to failures</button>' +
      '<div class="failhead"><span class="muted">Failure name</span><span class="mono failhead__name">' + esc(f.name) + '</span></div>' +
      apanel("Failure Hits", chartLine({ series: det.hits.series, labels: det.hits.labels, area: true }) + chartLegend(det.hits.series)) +
      apanel("Failure log", '<div class="table-wrap"><table class="atable"><thead><tr><th>Date</th><th>Package version</th><th>Device type</th><th>Device model</th><th>OS build</th><th>Links</th></tr></thead><tbody>' + logRows + '</tbody></table></div>') +
      '<div class="apanel-grid">' +
        apanel("Stack prevalence", '<div class="empty empty--sm"><iconify-icon icon="fluent:branch-20-regular" width="30" height="30" aria-hidden="true" style="opacity:.45"></iconify-icon><strong>No data available</strong><p class="muted">Upload symbols to resolve stacks for this failure.</p></div>') +
        apanel("Device configuration · CPU", '<table class="atable atable--sm"><thead><tr><th>CPU</th><th class="num">Share</th></tr></thead><tbody>' + cpuRows + '</tbody></table>') +
      '</div>';
  }

  /* ---- Store-gated tabs (acquisition / usage / ratings / performance) ---- */
  var STORE_TABDEF = {
    acquisition: { title: "Acquisition", line: "Daily installs", cards: [["Installs", "12,480", "↗ 8% this week"], ["Store page views", "48.2K", "25.9% conversion"], ["Markets", "84", "top: US · IN · BR"]] },
    usage: { title: "Usage", line: "Daily active users", cards: [["Daily active", "3,910", "+4.1% this week"], ["Median session", "27 min", "per active user"], ["D30 retention", "38%", "of new installs"]] },
    ratings: { title: "Ratings & reviews", line: "Average rating trend", cards: [["Average rating", "★ 4.6", "1,204 ratings"], ["Reviews", "318", "12 new this week"], ["Response rate", "72%", "to reviews"]] },
    performance: { title: "Performance", line: "Median launch time", cards: [["Median launch", "1.4s", "p95 2.6s"], ["Hang-free", "99.4%", "of sessions"], ["Memory p95", "412 MB", "working set"]] }
  };
  function storeTab(app, key) {
    var def = STORE_TABDEF[key];
    if (!app.store) {
      var cta = app.storeStatus === "in-progress"
        ? '<fluent-button appearance="primary" data-continue="' + app.id + '">Continue setup</fluent-button>'
        : '<fluent-button appearance="primary" data-store="' + app.id + '">Publish to Store</fluent-button>';
      var lockCards = '<div class="sumrow">' + def.cards.map(function (c) {
        return '<div class="sumcard is-locked"><div class="sumcard__blur"><span class="sumcard__label">' + esc(c[0]) + '</span>' +
          '<strong class="sumcard__big">' + esc(c[1]) + '</strong><span class="sumcard__sub muted">' + esc(c[2]) + '</span></div>' +
          '<div class="sa-card__lock"><iconify-icon icon="fluent:lock-closed-16-regular" width="15" height="15" aria-hidden="true"></iconify-icon>Unlocks with Store</div></div>';
      }).join("") + '</div>';
      return '<div class="unlock-hero"><img class="unlock-hero__illo" src="assets/data-trending.png" alt="" />' +
        '<div class="unlock-hero__body"><span class="pill pill--warn pill--sm">Locked</span>' +
        '<h3>' + esc(def.title) + ' unlocks with the Store</h3>' +
        '<p class="muted">Publish ' + esc(app.name) + ' to the Microsoft Store to see ' + def.title.toLowerCase() + ' across all your users.</p>' + cta +
        '</div></div>' + lockCards;
    }
    var rnd = anaRng(Math.abs(hashStr(app.id + key)) || 1), labels = [];
    for (var i = 0; i < 28; i++) { var dm = 18 + i; labels.push(dm > 31 ? dm - 31 : dm); }
    var series = [{ name: def.line, color: "var(--brand)", values: wave(rnd, 28, 1000, 700).map(Math.round) }];
    var cards = '<div class="sumrow">' + def.cards.map(function (c) { return sumCard(esc(c[0]), esc(c[1]), esc(c[2]), null, null, true); }).join("") + '</div>';
    return cards + apanel(def.line, chartLine({ series: series, labels: labels, area: true }) + chartLegend(series), "Preview — representative sample data");
  }

  // Once at least one app is on the Store, nudge the developer to publish the rest.
  function analyticsUpsell() {
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
    var body = anaTab === "crashes" ? crashTab(app)
      : !app.store ? storeTab(app, anaTab)
      : anaTab === "acquisition" ? acquisitionTab(app)
      : anaTab === "usage" ? usageTab(app)
      : anaTab === "ratings" ? ratingsTab(app)
      : storeTab(app, anaTab);
    var tabs = panelEl.querySelector(".anatabs"), bodyEl = panelEl.querySelector(".anabody");
    if (tabs && bodyEl) {
      // Keep the tab bar (and its icons) in the DOM — only flip the active state and
      // swap the body, so switching tabs doesn't re-render/flicker the tabs.
      tabs.querySelectorAll(".anatab").forEach(function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-anatab") === anaTab);
      });
      bodyEl.innerHTML = body;
    } else {
      panelEl.innerHTML = analyticsUpsell() + anaTabsHTML() + '<div class="anabody">' + body + '</div>';
    }
  }
  function renderAnalytics() {
    var sel = $("analyticsApp"), panelEl = $("analyticsPanel");
    if (!state.apps.length) { sel.innerHTML = ""; sel.style.display = "none"; panelEl.innerHTML = emptyAnalyticsHTML(); return; }
    sel.style.display = "";
    if (!analyticsAppId || !appById(analyticsAppId)) analyticsAppId = state.apps[0].id;
    sel.innerHTML = state.apps.map(function (a) {
      return '<option value="' + a.id + '"' + (a.id === analyticsAppId ? " selected" : "") + '>' + esc(a.name) + '</option>';
    }).join("");
    renderAnalyticsPanel();
  }
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
    if (!certs.length) { toast("Verify a certificate first", true); return; }
    certs.forEach(function (c) { discoverApps(c.thumb, c.id); });
  }

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
     to the embedded v4 publishing flow (publishing/publish.html). Created apps can be
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
    if (!a.store) a.storeStatus = "in-progress";        // reserved → entering the flow
    a.storeCreated = a.storeCreated || today();
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
    var i = ms.map(function (x) { return x.id; }).indexOf(a.id);
    if (i >= 0) ms[i] = Object.assign({}, ms[i], mapped); else ms.push(mapped);
    try { localStorage.setItem("msstore.apps", JSON.stringify(ms)); } catch (e) {}
    location.href = "publishing/publish.html?id=" + encodeURIComponent(a.id);
  }

  var STORE_MSA = { name: "Priya Nair", email: "priya.nair@outlook.com", initials: "PN" };

  // Demo: sign in as the verified WDP developer. Reads the REAL certificate from the
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
        }]
      }));
    } catch (e) {}
  }

  /* ---------------- Global wiring ---------------- */
  function wire() {
    $("msaTile").addEventListener("click", function () {
      state.signedIn = true; state.account = DEMO_MSA; state.verified = false;
      state.certs = []; state.apps = [];   // clean slate, then real cert + apps load in
      save(); showApp();
      toast("Signed in as " + DEMO_MSA.email, true);
      seedWdpDemo();
    });
    var t2 = $("msaTile2");
    if (t2) t2.addEventListener("click", function () { seedStoreDemo(); location.href = "store-portal.html#apps"; });
    $("msaOther").addEventListener("click", function () { toast("Demo build — use a listed account", true); });

    $("certModal").addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeModal(); });
    wireSources();
    wirePublish();
    // Apps value banner: show unless the developer dismissed it before.
    var hero = $("appsHero");
    if (hero) { try { hero.hidden = localStorage.getItem("wdp.appsHero.dismissed") === "1"; } catch (_) { hero.hidden = false; } }

    document.querySelector(".main").addEventListener("click", function (e) {
      if (e.target.closest("[data-openmodal]")) { e.preventDefault();
        if (state.verified) openModal(); else goView("overview"); return; }
      if (e.target.closest("[data-newapp]")) { openNewApp(); return; }
      if (e.target.closest("[data-rescan]")) { rescanApps(); return; }
      if (e.target.closest("[data-hero-dismiss]")) {
        try { localStorage.setItem("wdp.appsHero.dismissed", "1"); } catch (_) {}
        var hb = $("appsHero"); if (hb) hb.hidden = true; return;
      }
      var ms = e.target.closest("[data-sources]");
      if (ms) { openSources(ms.getAttribute("data-sources")); return; }
      var store = e.target.closest("[data-store]");
      if (store) { openPublish(store.getAttribute("data-store")); return; }
      var cont = e.target.closest("[data-continue]");
      if (cont) { openPublishFlow(cont.getAttribute("data-continue")); return; }
      var an = e.target.closest("[data-analytics]");
      if (an) { analyticsAppId = an.getAttribute("data-analytics"); anaTab = "crashes"; anaFailure = null; anaPage = 0; goView("analytics"); renderAnalytics(); return; }
      var rc = e.target.closest("[data-removecert]");
      if (rc) { var cid = rc.getAttribute("data-removecert");
        state.certs = state.certs.filter(function (c) { return c.id !== cid; });
        state.apps.forEach(function (a) { if (a.certId === cid) a.certId = null; });
        if (!state.certs.length) state.verified = false;
        save(); renderAll(); toast("Certificate removed", true); return; }
      var openapp = e.target.closest("[data-openapp]");
      if (openapp) { openPublishFlow(openapp.getAttribute("data-openapp")); return; }
      var atab = e.target.closest("[data-anatab]");
      if (atab) { anaTab = atab.getAttribute("data-anatab"); anaFailure = null; anaPage = 0; renderAnalyticsPanel(); return; }
      var frow = e.target.closest("[data-failure]");
      if (frow) { anaFailure = frow.getAttribute("data-failure"); window.scrollTo(0, 0); renderAnalyticsPanel(); return; }
      if (e.target.closest("[data-anaback]")) { anaFailure = null; renderAnalyticsPanel(); return; }
      var apg = e.target.closest("[data-anapage]");
      if (apg && !apg.hasAttribute("disabled")) { anaPage = +apg.getAttribute("data-anapage"); renderAnalyticsPanel(); return; }
      var jump = e.target.closest("[data-jump]"); if (jump) { e.preventDefault(); goView(jump.getAttribute("data-jump")); }
    });

    $("analyticsApp").addEventListener("change", function () {
      var v = readDropdownValue($("analyticsApp"));
      if (v) { analyticsAppId = v; anaFailure = null; anaPage = 0; renderAnalyticsPanel(); }
    });

    $("resetState").addEventListener("click", function (e) {
      e.preventDefault();
      if (confirm("Clear all certificates, apps, and verification state?")) {
        localStorage.removeItem(KEY); state = load(); save(); renderAll(); showSignin();
      }
    });

    wireNav();
  }

  /* ---------------- Sidebar view router ---------------- */
  var VIEWS = ["overview", "apps", "certificates", "analytics"];
  function showView(id) {
    if (VIEWS.indexOf(id) === -1) id = "overview";
    document.querySelectorAll(".main .block").forEach(function (b) { b.classList.toggle("active", b.id === id); });
    document.querySelectorAll(".snav a[data-nav]").forEach(function (l) { l.classList.toggle("is-active", l.getAttribute("href").slice(1) === id); });
    if (id === "analytics") renderAnalytics();
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
  else if (state.signedIn && state.account) showApp();
  else showSignin();
})();
