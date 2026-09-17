(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CertificateDiscovery = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ANALYTICS_DELAY_MS = 24 * 60 * 60 * 1000;
  var PROCESS_WORDS = /\b(?:updater?|updating|crashpad|crash|helper|service|svc|agent|daemon|setup|installer?|uninstaller?|redist|runtime|bootstrap|notification|codec|renderer|inject|offsets|browser page)\b/i;
  var TRACKING_MODES = { app: "Apps + crash analytics", analytics: "Crash analytics only", none: "Not included" };

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
    var process = /^(process|service|component|library|helper)$/.test(kind) || /\.(dll|sys)$/i.test(file || name);
    if (flag === false) return { recommended: false, role: "Needs review", reason: "Not recommended by discovery metadata" };
    if (process) return { recommended: false, role: "Process or component", reason: "Identified as a process or component" };
    if (flag === true || kind === "app")
      return { recommended: true, role: "Likely app", reason: "Application metadata or a Start menu entry was found" };
    if (PROCESS_WORDS.test(words))
      return { recommended: false, role: "Likely process", reason: "The name suggests a helper, service, or component" };
    if (item.hasStartMenuEntry === true)
      return { recommended: true, role: "Likely app", reason: "A Start menu entry was found" };
    if (item.hasStartMenuEntry === false)
      return { recommended: false, role: "Needs review", reason: "No user-facing entry point was identified. Confirm whether this executable is an app or a background component." };
    // Engagement measures activity, not whether an executable is a user-facing app.
    if (name && !/\.(exe|dll|sys|bin)$/i.test(name) && /[a-z]/i.test(name))
      return { recommended: true, role: "Likely app", reason: "A product name was found; confirm that this is an app" };
    return { recommended: false, role: "Needs review", reason: "An executable name alone does not identify an app" };
  }

  function hasReviewedSelection(cert, apps) {
    return !!(cert.appSelectionReviewed || Object.keys(cert.trackingSelections || {}).length || Object.keys(cert.appSelections || {}).length ||
      (apps || []).some(function (a) { return a.certId === cert.id; }));
  }

  function trackingSuggestion(item, suggestion, name, file) {
    var kind = key(item.kind || item.type || item.Type), words = (name + ' ' + file).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]/g, ' ');
    var helper = /^(process|service|component|library|helper)$/.test(kind) || PROCESS_WORDS.test(words) || /\.(dll|sys)$/i.test(file || name);
    var temporary = /\b(?:setup|installer?|uninstaller?|redist|bootstrap|codec)\b/i.test(words) || /\.(dll|sys)$/i.test(file || name);
    var role = suggestion.recommended ? 'app' : helper ? 'helper' : 'review';
    var mode = role === 'app' ? 'app' : role === 'helper' && !temporary ? 'analytics' : 'none';
    if (typeof item.recommendedAnalytics === 'boolean' && role !== 'app') mode = item.recommendedAnalytics ? 'analytics' : 'none';
    return { role: role, mode: mode, reason: role === 'app' ? suggestion.reason : role === 'review' ? suggestion.reason
      : mode === 'analytics' ? 'Background component: its failures can affect the app. Track crashes without adding an app entry.'
      : 'Setup, library, or low-confidence component. Not included by default; you can change this.' };
  }

  function executableTargets(certs, apps, includeExcluded) {
    var targets = new Map();
    (certs || []).forEach(function (cert) {
      (cert.executables || []).forEach(function (target) { targets.set(target.id, Object.assign({}, target, { certId: cert.id })); });
    });
    (apps || []).forEach(function (app) {
      if (!app.certId || targets.has(app.id) || Array.from(targets.values()).some(function (target) { return target.appId === app.id; })) return;
      targets.set(app.id, Object.assign({}, app, { mode: 'app', appId: app.id, discoveryKey: app.discoveryKey || 'saved:' + app.id }));
    });
    return Array.from(targets.values()).filter(function (target) { return includeExcluded || target.mode !== 'none'; });
  }

  function trackingMode(candidate) {
    if (candidate.locked) return 'app';
    if (candidate.mode && candidate.mode !== candidate.initialMode) return TRACKING_MODES[candidate.mode] ? candidate.mode : 'none';
    if (candidate.initialSelected != null && candidate.selected !== candidate.initialSelected) return candidate.selected ? 'app' : 'none';
    return TRACKING_MODES[candidate.mode] ? candidate.mode : candidate.selected ? 'app' : 'none';
  }

  function normalize(rows, cert, existingApps, allCerts) {
    if (!Array.isArray(rows)) return [];
    var existing = new Map(), seen = new Map();
    var choices = cert.appSelections || {};
    var trackingChoices = cert.trackingSelections || {}, tracked = new Map();
    executableTargets(allCerts || [cert], existingApps, true).forEach(function (target) { tracked.set(key(target.discoveryKey), target); });
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
        storeManaged: !!(matched && (matched.store || matched.storeStatus)),
        locked: !!(matched && !relink && (matched.store || matched.storeStatus))
      };
      candidate.selected = !!candidate.existingId || (!candidate.relinkId && (Object.prototype.hasOwnProperty.call(choices, identity) ? choices[identity] === true : !reviewed && candidate.recommended));
      var advice = trackingSuggestion(item, suggestion, name, file), target = tracked.get(identity);
      var targetRelink = target && target.certId !== cert.id;
      candidate.suggestedRole = advice.role; candidate.suggestedMode = advice.mode; candidate.trackingReason = advice.reason;
      candidate.product = text(item.productFamily || item.productName || item.ProductName);
      candidate.applicationKey = text(item.applicationId || item.appGroupId || item.packageFamilyName || target?.applicationKey);
      candidate.relatedApplicationKey = text(item.parentApplicationId || item.relatedApplicationId || target?.relatedApplicationKey);
      candidate.mode = candidate.locked ? 'app' : targetRelink ? 'none' : Object.prototype.hasOwnProperty.call(trackingChoices, identity) ? trackingChoices[identity]
        : target ? target.mode : candidate.selected ? 'app' : reviewed ? 'none' : advice.mode;
      candidate.initialMode = candidate.mode; candidate.initialSelected = candidate.selected;
      candidate.targetId = target && !targetRelink ? target.id : null;
      candidate.relinkTargetId = targetRelink ? target.id : null;
      if (!candidate.existingId && target && !targetRelink && target.mode === 'app' && (existingApps || []).some(function (app) { return app.id === target.appId; })) candidate.existingId = target.appId;
      candidate.savedMode = target && !targetRelink ? target.mode : candidate.existingId ? 'app' : 'none';
      seen.set(identity, candidate);
    });
    // A stopped process can disappear from a scan without being deselected by its owner.
    (existingApps || []).forEach(function (a) {
      if (a.certId !== cert.id) return;
      var identity = key(a.discoveryKey || "saved:" + a.id);
      if (seen.has(identity)) return;
      var suggestion = suggest({}, a.name || a.file, a.file || "");
      var advice = trackingSuggestion({}, suggestion, a.name || a.file, a.file || '');
      seen.set(identity, { key: identity, name: a.name || a.file, file: a.file || "", path: "", version: "", icon: a.icon || "",
        engagementMs: null, recommended: suggestion.recommended, role: suggestion.role, reason: suggestion.reason,
        certId: cert.id, thumb: cert.thumb, certName: cert.label, existingId: a.id, relinkId: null,
        locked: !!(a.store || a.storeStatus), selected: true, initialSelected: true,
        suggestedRole: advice.role, suggestedMode: advice.mode, trackingReason: advice.reason,
        mode: 'app', initialMode: 'app', savedMode: 'app', targetId: a.id, applicationKey: a.applicationKey || '', product: a.name });
    });
    (cert.executables || []).forEach(function (target) {
      var identity = key(target.discoveryKey);
      if (seen.has(identity)) return;
      var suggestion = suggest({}, target.name || target.file, target.file || ''), advice = trackingSuggestion({}, suggestion, target.name || target.file, target.file || '');
      seen.set(identity, Object.assign({}, target, { key: identity, certId: cert.id, thumb: cert.thumb, certName: cert.label,
        targetId: target.id, existingId: null, relinkId: null, selected: target.mode === 'app', initialSelected: target.mode === 'app',
        initialMode: target.mode, savedMode: target.mode, suggestedRole: target.suggestedRole || advice.role,
        suggestedMode: target.suggestedMode || advice.mode, recommended: (target.suggestedRole || advice.role) === 'app',
        trackingReason: target.trackingReason || advice.reason, missingFromScan: true }));
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
      added.push({ id: c.targetId || options.createId(), name: c.name, file: c.file, size: c.version ? "v" + c.version : "",
        icon: c.icon || null, signerThumb: cert.thumb, signerSubject: cert.subject, trust: cert.trust, certId: cert.id,
        sources: [], store: false, added: options.addedLabel || new Date(now).toLocaleDateString(), discoveryKey: c.key,
        discovered: true, discoveredAt: c.trackedAt == null ? now : c.trackedAt });
      keys.add(key(c.key));
    });
    return {
      apps: apps.filter(function (a) { return !removed.has(a.id); }).map(function (a) { return appUpdates.get(a.id) || a; }).concat(added),
      certs: certs.map(function (c) { return certUpdates.get(c.id) || c; }),
      added: added.length, removed: removed.size, relinked: appUpdates.size
    };
  }

  function applyTrackingSelection(candidates, certs, apps, options) {
    options = options || {};
    var now = options.now == null ? Date.now() : options.now;
    var targets = executableTargets(certs, apps, true), byKey = new Map(targets.map(function (target) { return [key(target.discoveryKey), target]; }));
    var registries = new Map(), choices = new Map(), newTargets = 0;
    function registry(certId) {
      if (!registries.has(certId)) registries.set(certId, targets.filter(function (target) { return target.certId === certId; }));
      return registries.get(certId);
    }
    var appCandidates = candidates.map(function (candidate) {
      var cert = certs.find(function (entry) { return entry.id === candidate.certId; });
      if (!cert) return Object.assign({}, candidate, { selected: false });
      var mode = trackingMode(candidate), identity = key(candidate.key), previous = byKey.get(identity);
      var previousApp = previous && apps.find(function (app) { return app.id === previous.appId || app.id === previous.id; });
      if (previousApp && (previousApp.store || previousApp.storeStatus)) mode = previous.certId === cert.id ? 'app' : mode === 'app' ? 'app' : 'none';
      if (!choices.has(cert.id)) choices.set(cert.id, Object.assign({}, cert.trackingSelections));
      choices.get(cert.id)[identity] = mode;
      if (previous && previous.certId !== cert.id && mode === 'none') return Object.assign({}, candidate, { selected: false });
      if (!previous && mode === 'none') return Object.assign({}, candidate, { selected: false });
      if (!previous) newTargets++;
      var target = Object.assign({}, previous, { id: previous ? previous.id : options.createId(), discoveryKey: identity,
        name: candidate.name, file: candidate.file, path: candidate.path || '', version: candidate.version || '', icon: candidate.icon || previous?.icon || null,
        certId: cert.id, signerThumb: cert.thumb, signerSubject: cert.subject, trust: cert.trust,
        mode: mode, appId: mode === 'app' ? previous?.id || null : null, discovered: true,
        discoveredAt: previous?.discoveredAt == null ? now : previous.discoveredAt,
        suggestedRole: candidate.suggestedRole, suggestedMode: candidate.suggestedMode, trackingReason: candidate.trackingReason,
        applicationKey: candidate.applicationKey || previous?.applicationKey || '', relatedApplicationKey: candidate.relatedApplicationKey || '', product: candidate.product || '' });
      if (mode === 'app') target.appId = target.id;
      if (previous && previous.certId !== cert.id) {
        registries.set(previous.certId, registry(previous.certId).filter(function (entry) { return entry.id !== previous.id; }));
        var oldCert = certs.find(function (entry) { return entry.id === previous.certId; });
        if (!choices.has(previous.certId)) choices.set(previous.certId, Object.assign({}, oldCert?.trackingSelections));
        choices.get(previous.certId)[identity] = 'none';
      }
      var entries = registry(cert.id), index = entries.findIndex(function (entry) { return entry.id === target.id; });
      if (index < 0) entries.push(target); else entries[index] = target;
      byKey.set(identity, target);
      return Object.assign({}, candidate, { selected: mode === 'app', targetId: target.id, trackedAt: target.discoveredAt });
    });
    var appGroups = new Map(), groupedIds = new Set();
    appCandidates.forEach(function (candidate) {
      if (!candidate.selected || !candidate.applicationKey || candidate.locked) return;
      var groupKey = candidate.certId + ':' + candidate.applicationKey;
      if (!appGroups.has(groupKey)) {
        var existingApp = apps.find(function (app) { return app.certId === candidate.certId && (app.applicationKey === candidate.applicationKey || app.id === candidate.existingId); });
        appGroups.set(groupKey, { id: existingApp ? existingApp.id : 'app-' + options.createId(), candidate: candidate, name: candidate.product || candidate.name });
      }
      var group = appGroups.get(groupKey), target = byKey.get(key(candidate.key));
      target.appId = group.id;
      groupedIds.add(group.id);
      if (candidate === group.candidate) {
        candidate.targetId = group.id; candidate.name = group.name;
        candidate.existingId = apps.some(function (app) { return app.id === group.id; }) ? group.id : null;
      } else {
        candidate.selected = false;
        if (candidate.existingId === group.id) candidate.existingId = null;
      }
    });
    appCandidates.forEach(function (candidate) {
      if (!candidate.selected && groupedIds.has(candidate.existingId)) candidate.existingId = null;
    });
    var next = applySelection(appCandidates, certs, apps, options);
    var touchedTargets = new Map();
    registries.forEach(function (entries) { entries.forEach(function (target) { touchedTargets.set(target.id, target); }); });
    next.apps = next.apps.filter(function (app) {
      var target = touchedTargets.get(app.id);
      return !target || app.store || app.storeStatus || groupedIds.has(app.id) || target.mode === 'app';
    }).map(function (app) {
      var group = Array.from(appGroups.values()).find(function (entry) { return entry.id === app.id; });
      return group ? Object.assign({}, app, { applicationKey: group.candidate.applicationKey, primaryTargetId: byKey.get(key(group.candidate.key)).id }) : app;
    });
    next.certs = next.certs.map(function (cert) {
      return choices.has(cert.id) ? Object.assign({}, cert, { trackingSelections: choices.get(cert.id), executables: registry(cert.id), appSelectionReviewed: true }) : cert;
    });
    next.newTargets = newTargets;
    return next;
  }

  function trackingCounts(cert, apps) {
    var counts = selectionCounts(cert, apps), targets = executableTargets([cert], (apps || []).filter(function (app) { return app.certId === cert.id; }));
    return { identified: counts.identified, apps: counts.selected, analyticsOnly: targets.filter(function (target) { return target.mode === 'analytics'; }).length,
      tracked: targets.length, demo: counts.demo };
  }

  function reviewCounts(candidates) {
    var appKeys = new Set(), analyticsOnly = 0, excluded = 0, needsReview = 0;
    candidates.forEach(function (candidate) {
      var mode = trackingMode(candidate);
      if (mode === 'app') appKeys.add(candidate.applicationKey ? candidate.certId + ':' + candidate.applicationKey : candidate.key);
      else if (mode === 'analytics') analyticsOnly++; else excluded++;
      if (candidate.suggestedRole === 'review') needsReview++;
    });
    return { apps: appKeys.size, analyticsOnly: analyticsOnly, excluded: excluded, tracked: candidates.length - excluded, needsReview: needsReview };
  }

  function view(candidates, options) {
    options = options || {};
    var query = key(options.query), group = options.group || "all", sort = options.sort || "engagement";
    return candidates.filter(function (c) {
      if (group === "recommended" && !c.recommended) return false;
      if (group === "other" && c.recommended) return false;
      if (group === "selected" && !c.selected) return false;
      if (options.role && options.role !== 'all' && c.suggestedRole !== options.role) return false;
      if (options.mode && options.mode !== 'all' && trackingMode(c) !== options.mode) return false;
      return !query || key([c.name, c.file, c.path, c.version, c.role, c.certName, c.product].join(" ")).indexOf(query) !== -1;
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
    isAnalyticsPending: isAnalyticsPending, ANALYTICS_DELAY_MS: ANALYTICS_DELAY_MS,
    applyTrackingSelection: applyTrackingSelection, executableTargets: executableTargets, trackingMode: trackingMode, trackingCounts: trackingCounts, reviewCounts: reviewCounts, TRACKING_MODES: TRACKING_MODES };
});