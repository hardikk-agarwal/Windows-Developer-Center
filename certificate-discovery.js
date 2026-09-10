(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CertificateDiscovery = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ANALYTICS_DELAY_MS = 24 * 60 * 60 * 1000;
  var PROCESS_WORDS = /\b(?:updater?|updating|crashpad|crash|helper|service|svc|agent|daemon|setup|installer?|uninstaller?|redist|runtime|bootstrap|notification|codec|renderer|inject|offsets|browser page)\b/i;

  function text(value) { return value == null ? "" : String(value).trim(); }
  function key(value) { return text(value).replace(/\\/g, "/").toLowerCase(); }
  function number(value) {
    if (value == null || text(value) === "") return null;
    var n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  async function requestJson(url, options, fetcher) {
    var response;
    try { response = await (fetcher || fetch)(url, options); }
    catch (e) { return { offline: true }; }
    if (response.status === 404 || response.status === 405 || response.status >= 500) return { offline: true };
    if (!response.ok) throw new Error("Request failed: " + response.status);
    // Static SPA hosts may return their HTML entry point for an absent API route.
    var type = response.headers && response.headers.get("content-type") || "";
    if (/text\/html/i.test(type)) return { offline: true };
    return { offline: false, data: await response.json() };
  }

  function suggest(item, name, file) {
    var kind = key(item.kind || item.type || item.Type);
    var flag = item.recommended != null ? item.recommended : item.Recommended;
    var words = (name + " " + file).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.-]/g, " ");
    var process = /^(process|service|component|library)$/.test(kind) || /\.(dll|sys)$/i.test(file || name);
    if (flag === false) return { recommended: false, role: "Needs review", reason: "Not recommended by discovery metadata" };
    if (process) return { recommended: false, role: "Process or component", reason: "Identified as a process or component" };
    if (flag === true || kind === "app")
      return { recommended: true, role: "Likely app", reason: "Application metadata or a Start menu entry was found" };
    if (PROCESS_WORDS.test(words))
      return { recommended: false, role: "Likely process", reason: "The name suggests a helper, service, or component" };
    if (item.hasStartMenuEntry === true)
      return { recommended: true, role: "Likely app", reason: "A Start menu entry was found" };
    // Engagement measures activity, not whether an executable is a user-facing app.
    if (name && !/\.(exe|dll|sys|bin)$/i.test(name) && /[a-z]/i.test(name))
      return { recommended: true, role: "Likely app", reason: "A product name was found; confirm that this is an app" };
    return { recommended: false, role: "Needs review", reason: "An executable name alone does not identify an app" };
  }

  function hasReviewedSelection(cert, apps) {
    return !!(cert.appSelectionReviewed || Object.keys(cert.appSelections || {}).length ||
      (apps || []).some(function (a) { return a.certId === cert.id; }));
  }

  function normalize(rows, cert, existingApps) {
    if (!Array.isArray(rows)) return [];
    var existing = new Map(), seen = new Map();
    var choices = cert.appSelections || {};
    var reviewed = hasReviewedSelection(cert, existingApps);
    (existingApps || []).forEach(function (a) { if (a.discoveryKey) existing.set(key(a.discoveryKey), a); });
    rows.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var name = text(item.ProductName || item.productName || item.name || item.file || item.FileName);
      var file = text(item.file || item.FileName || item.fileName);
      if (!name) return;
      if (!file && /\.(exe|dll|sys|bin)$/i.test(name)) file = name;
      var path = text(item.path || item.Path), identity;
      if (path) identity = "p:" + key(path);
      else if (item.id || item.productId) identity = "product:" + key(cert.thumb) + ":" + key(item.productId || item.id);
      else identity = "product:" + key(cert.thumb) + ":" + key(name) + ":" + key(file);
      var engagement = number(item.TotalEngagementDurationMS != null ? item.TotalEngagementDurationMS
        : item.totalEngagementDurationMS != null ? item.totalEngagementDurationMS : item.engagementMs);
      if (seen.has(identity)) {
        var previous = seen.get(identity);
        if (engagement != null) previous.engagementMs = Math.max(previous.engagementMs || 0, engagement);
        return;
      }
      var suggestion = suggest(item, name, file);
      var matched = existing.get(identity), relink = matched && matched.certId && matched.certId !== cert.id;
      var candidate = {
        key: identity, name: name, file: file, path: path,
        version: text(item.version || item.ProductVersion), icon: text(item.icon),
        engagementMs: engagement, recommended: suggestion.recommended,
        role: text(item.role) || suggestion.role, reason: suggestion.reason,
        certId: cert.id, thumb: cert.thumb, certName: cert.label || "Signing certificate",
        existingId: matched && !relink ? matched.id : null,
        relinkId: relink ? matched.id : null,
        locked: !!(matched && !relink && (matched.store || matched.storeStatus))
      };
      candidate.selected = !!candidate.existingId || (!candidate.relinkId && (Object.prototype.hasOwnProperty.call(choices, identity) ? choices[identity] === true : !reviewed && candidate.recommended));
      seen.set(identity, candidate);
    });
    // A stopped process can disappear from a scan without being deselected by its owner.
    (existingApps || []).forEach(function (a) {
      if (a.certId !== cert.id) return;
      var identity = key(a.discoveryKey || "saved:" + a.id);
      if (seen.has(identity)) return;
      var suggestion = suggest({}, a.name || a.file, a.file || "");
      seen.set(identity, { key: identity, name: a.name || a.file, file: a.file || "", path: "", version: "", icon: a.icon || "",
        engagementMs: null, recommended: suggestion.recommended, role: suggestion.role, reason: suggestion.reason,
        certId: cert.id, thumb: cert.thumb, certName: cert.label, existingId: a.id, relinkId: null,
        locked: !!(a.store || a.storeStatus), selected: true });
    });
    return Array.from(seen.values());
  }

  function summarizeDiscovery(candidates, certId, source, now) {
    var keys = new Set(candidates.filter(function (c) { return c.certId === certId; }).map(function (c) { return key(c.key); }));
    return { identified: keys.size, source: source === "demo" ? "demo" : "live", checkedAt: now == null ? Date.now() : now };
  }

  function selectionCounts(cert, apps) {
    var linked = (apps || []).filter(function (a) { return a.certId === cert.id; });
    var summary = cert.discoverySummary;
    if (summary && Number.isInteger(summary.identified) && summary.identified >= 0)
      return { identified: summary.identified, selected: linked.length, demo: summary.source === "demo" };
    // Older saved choices include unchecked results, but an app count alone is not a discovery total.
    var choices = Object.keys(cert.appSelections || {}), known = new Set(choices.map(key));
    if (choices.length) linked.forEach(function (a) { known.add(key(a.discoveryKey || "saved:" + a.id)); });
    return { identified: choices.length ? known.size : null, selected: linked.length, demo: cert.thumbKind === "hash" };
  }

  function applySelection(candidates, certs, apps, options) {
    options = options || {};
    var now = options.now == null ? Date.now() : options.now;
    var byId = new Map(apps.map(function (a) { return [a.id, a]; }));
    var keys = new Set(apps.map(function (a) { return key(a.discoveryKey); }));
    var certUpdates = new Map(), appUpdates = new Map(), removed = new Set(), added = [];
    candidates.forEach(function (c) {
      var cert = certs.find(function (x) { return x.id === c.certId; });
      if (!cert) return;
      if (!certUpdates.has(cert.id)) certUpdates.set(cert.id, Object.assign({}, cert, {
        appSelections: Object.assign({}, cert.appSelections), appSelectionReviewed: true
      }));
      var current = byId.get(c.existingId || c.relinkId), keepStore = current && c.existingId && (current.store || current.storeStatus);
      var selected = !!(c.selected || c.locked || keepStore);
      certUpdates.get(cert.id).appSelections[key(c.key)] = selected;
      if (c.existingId && current) {
        if (!selected && current.certId === cert.id) removed.add(current.id);
        return;
      }
      if (!selected) return;
      if (c.relinkId && current) {
        appUpdates.set(current.id, Object.assign({}, current, { certId: cert.id, signerThumb: cert.thumb, signerSubject: cert.subject, trust: cert.trust }));
        return;
      }
      if (keys.has(key(c.key))) return;
      added.push({ id: options.createId(), name: c.name, file: c.file, size: c.version ? "v" + c.version : "",
        icon: c.icon || null, signerThumb: cert.thumb, signerSubject: cert.subject, trust: cert.trust, certId: cert.id,
        sources: [], store: false, added: options.addedLabel || new Date(now).toLocaleDateString(), discoveryKey: c.key,
        discovered: true, discoveredAt: now });
      keys.add(key(c.key));
    });
    return {
      apps: apps.filter(function (a) { return !removed.has(a.id); }).map(function (a) { return appUpdates.get(a.id) || a; }).concat(added),
      certs: certs.map(function (c) { return certUpdates.get(c.id) || c; }),
      added: added.length, removed: removed.size, relinked: appUpdates.size
    };
  }

  function view(candidates, options) {
    options = options || {};
    var query = key(options.query), group = options.group || "all", sort = options.sort || "engagement";
    return candidates.filter(function (c) {
      if (group === "recommended" && !c.recommended) return false;
      if (group === "other" && c.recommended) return false;
      if (group === "selected" && !c.selected) return false;
      return !query || key([c.name, c.file, c.path, c.version, c.role, c.certName].join(" ")).indexOf(query) !== -1;
    }).sort(function (a, b) {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      if (sort === "engagement" && a.engagementMs !== b.engagementMs)
        return (b.engagementMs == null ? -1 : b.engagementMs) - (a.engagementMs == null ? -1 : a.engagementMs);
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.key.localeCompare(b.key);
    });
  }

  function formatEngagement(ms) {
    if (ms == null) return "Not available";
    var hours = ms / 3600000;
    if (hours > 0 && hours < 0.1) return "<0.1 h";
    return hours.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 }) + " h";
  }

  function isAnalyticsPending(app, now) {
    if (!app || !app.discovered || app.store || app.storeStatus === "published" || app.discoveredAt == null) return false;
    var added = typeof app.discoveredAt === "number" ? app.discoveredAt : Date.parse(app.discoveredAt);
    return Number.isFinite(added) && (now == null ? Date.now() : now) < added + ANALYTICS_DELAY_MS;
  }

  return { normalize: normalize, hasReviewedSelection: hasReviewedSelection, summarizeDiscovery: summarizeDiscovery, selectionCounts: selectionCounts,
    applySelection: applySelection, requestJson: requestJson, view: view, key: key, formatEngagement: formatEngagement,
    isAnalyticsPending: isAnalyticsPending, ANALYTICS_DELAY_MS: ANALYTICS_DELAY_MS };
});