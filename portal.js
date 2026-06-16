/* Trusted Developer Portal — data-driven, persisted to localStorage.
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
  function trustWord(s) { return s === "Valid" ? "trusted" : s === "NotSigned" ? "unsigned" : "self-signed (not yet trusted)"; }
  function trustPill(t) {
    if (t === "Valid") return '<span class="pill pill--ok pill--sm">Valid</span>';
    if (t === "Offline") return '<span class="pill pill--ghost pill--sm">Hash only</span>';
    if (t === "NotSigned") return '<span class="pill pill--warn pill--sm">Unsigned</span>';
    return '<span class="pill pill--warn pill--sm">Untrusted</span>';
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
            '<h2>Get verified to get trusted</h2>' +
            '<p class="muted">Prove you own a code signing certificate to become a trusted developer.</p>' +
          '</div>' +
        '</div>';
      return;
    }
    var valid = hasValidCert();
    var pill = valid
      ? '<span class="pill pill--ok"><span class="verified-dot"></span>Verified Developer</span>'
      : '<span class="pill pill--warn">Identity verified · certificate not trusted</span>';
    var head = valid ? esc(state.account.name) + " is trusted on Windows"
                     : esc(state.account.name) + "’s identity is verified";
    var body = valid
      ? "Your identity and code signing certificate are verified. Apps you sign install without SmartScreen interruptions and have crash analytics unlocked."
      : "Your <strong>identity</strong> is verified, but your certificate is self-signed and not chain-trusted by Windows — installs may still show SmartScreen. Use a CA-issued code signing certificate for frictionless installs.";
    el.innerHTML =
      '<div class="status-card' + (valid ? '' : ' status-card--off') + '">' +
        '<img class="status-card__illo" src="assets/' + (valid ? 'shield-person' : 'trust') + '.png" alt="" />' +
        '<div class="status-card__body">' +
          pill +
          '<h2>' + head + '</h2>' +
          '<p class="muted">' + body + '</p>' +
          '<fluent-button appearance="outline" size="small" data-openmodal style="margin-top:14px">Add certificate</fluent-button>' +
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
        ? '<span class="pill pill--ok pill--sm"><span class="verified-dot"></span>Trusted</span>'
        : '<span class="pill pill--warn pill--sm">Cert not trusted</span>';
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
  var ANA_TABS = [
    { key: "crashes",     label: "Crashes",           icon: "fluent:bug-20-regular", free: true },
    { key: "acquisition", label: "Acquisition",       icon: "fluent:arrow-download-20-regular" },
    { key: "usage",       label: "Usage",             icon: "fluent:pulse-20-regular" },
    { key: "ratings",     label: "Ratings & reviews", icon: "fluent:star-20-regular" },
    { key: "performance", label: "Performance",       icon: "fluent:heart-pulse-20-regular" }
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
    var W = 840, H = o.h || 260, pl = 46, pr = 16, pt = 14, pb = 30, iw = W - pl - pr, ih = H - pt - pb;
    var mx = 1; o.series.forEach(function (s) { s.values.forEach(function (v) { if (v > mx) mx = v; }); }); mx = niceMax(mx);
    var n = o.series[0].values.length;
    function X(i) { return pl + (n <= 1 ? 0 : iw * i / (n - 1)); }
    function Y(v) { return pt + ih - ih * (v / mx); }
    var grid = "", ylab = "";
    for (var g = 0; g <= 4; g++) { var gy = pt + ih * g / 4;
      grid += '<line x1="' + pl + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + gy.toFixed(1) + '" class="chart-grid"/>';
      ylab += '<text x="' + (pl - 8) + '" y="' + (gy + 4).toFixed(1) + '" class="chart-axis chart-axis--y">' + fmtCompact(mx * (1 - g / 4)) + '</text>'; }
    var xlab = "", stepX = Math.ceil(n / 8);
    for (var xi = 0; xi < n; xi += stepX) xlab += '<text x="' + X(xi).toFixed(1) + '" y="' + (H - 10) + '" class="chart-axis">' + esc("" + o.labels[xi]) + '</text>';
    var paths = o.series.map(function (s, si) {
      var pts = s.values.map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join(" ");
      var area = (o.area && si === 0) ? '<polygon points="' + pl + ',' + (pt + ih) + ' ' + pts + ' ' + (pl + iw) + ',' + (pt + ih) + '" fill="url(#agrad)"/>' : "";
      return area + '<polyline points="' + pts + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    }).join("");
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img"><defs><linearGradient id="agrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--brand)" stop-opacity=".26"/><stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>' + grid + ylab + paths + xlab + '</svg>';
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
  function crashTab(app) {
    var d = anaData(app);
    if (anaFailure) return failureView(app, d);
    var cards = '<div class="sumrow">' +
      sumCard("Crashes", fmtCompact(d.crashes), "Last 12 months", d.hits.series[0].values, "var(--brand)") +
      sumCard("Hangs", fmtCompact(d.hangs), "Last 12 months", d.hits.series[1].values, "#C239B3") +
      sumCard("Crash rate", d.crashRate + "%", "Last 12 months", d.hits.series[2].values, "#8661C5") + '</div>';
    return cards +
      apanel("Failure Hits", chartLine({ series: d.hits.series, labels: d.hits.labels, area: true }) + chartLegend(d.hits.series)) +
      apanel("Failure distribution", chartBars({ bars: d.dist }), "Crashes by app version") +
      apanel("Failures", failuresTable(app, d));
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
    var body = anaTab === "crashes" ? crashTab(app) : storeTab(app, anaTab);
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

  /* ---------------- Global wiring ---------------- */
  function wire() {
    $("msaTile").addEventListener("click", function () {
      state.signedIn = true; state.account = DEMO_MSA; save(); showApp();
      toast("Signed in as " + DEMO_MSA.email, true);
    });
    $("msaOther").addEventListener("click", function () { toast("Demo build — use the listed account", true); });

    $("certModal").addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeModal(); });
    wireSources();
    wirePublish();

    document.querySelector(".main").addEventListener("click", function (e) {
      if (e.target.closest("[data-openmodal]")) { e.preventDefault();
        if (state.verified) openModal(); else goView("overview"); return; }
      if (e.target.closest("[data-newapp]")) { openNewApp(); return; }
      if (e.target.closest("[data-rescan]")) { rescanApps(); return; }
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
  var VIEWS = ["overview", "certificates", "apps", "analytics"];
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
