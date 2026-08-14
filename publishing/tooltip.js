// Real Fluent tooltip — attaches a <fluent-tooltip> (from the Fluent web-components bundle) to every
// [data-tooltip] element, so the whole flow uses the proper Fluent v9 component. Keeps the existing
// data-tooltip / data-tooltip-placement authoring API; anchors each tooltip to a generated id.
(function () {
  var seq = 0;
  // data-tooltip-placement -> Fluent positioning (default: after = to the right of the source).
  var PLACE = { top: 'above', bottom: 'below', left: 'before', right: 'after' };

  function bind(el) {
    if (!el || el.__fttBound) return;
    var text = el.getAttribute('data-tooltip');
    if (!text) return;
    el.__fttBound = true;
    if (!el.id) el.id = 'ftt-' + (++seq);
    var tip = document.createElement('fluent-tooltip');
    tip.setAttribute('anchor', el.id);
    tip.setAttribute('positioning', PLACE[el.getAttribute('data-tooltip-placement')] || 'after');
    tip.setAttribute('delay', '300');
    tip.textContent = text;
    document.body.appendChild(tip);
    el.__fttTip = tip;
  }

  function unbind(el) {
    if (el && el.__fttTip) { el.__fttTip.remove(); el.__fttTip = null; el.__fttBound = false; }
  }

  function bindAll(root) { (root || document).querySelectorAll('[data-tooltip]').forEach(bind); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bindAll(); });
  else bindAll();

  // Bind newly-added anchors; drop tooltips whose anchor was removed (tables/wizard re-render) so
  // detached <fluent-tooltip> elements don't accumulate on <body>.
  new MutationObserver(function (records) {
    records.forEach(function (rec) {
      rec.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches('[data-tooltip]')) bind(n);
        if (n.querySelectorAll) n.querySelectorAll('[data-tooltip]').forEach(bind);
      });
      rec.removedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.__fttTip) unbind(n);
        if (n.querySelectorAll) n.querySelectorAll('[data-tooltip]').forEach(unbind);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
