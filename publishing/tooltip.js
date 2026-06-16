// Fluent-style tooltip — auto-shows on hover/focus of any [data-tooltip] element.
// Positions to the right of the source (or flips to the left at viewport edge).
(function () {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);

  let showTimer = null;
  const SHOW_DELAY = 300;
  const GAP = 10;

  function position(el) {
    const r = el.getBoundingClientRect();
    const tt = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;

    // Prefer right of element; flip to left if it would overflow
    let left = r.right + GAP;
    if (left + tt.width > vw - 8) left = r.left - tt.width - GAP;
    const top = r.top + r.height / 2 - tt.height / 2;

    tooltip.style.left = Math.max(8, left) + 'px';
    tooltip.style.top  = Math.max(8, top) + 'px';
  }

  function show(el) {
    const text = el.getAttribute('data-tooltip');
    if (!text) return;
    tooltip.textContent = text;
    tooltip.classList.add('tooltip--visible');
    position(el);
  }
  function hide() { tooltip.classList.remove('tooltip--visible'); }

  function bind(el) {
    el.addEventListener('mouseenter', () => {
      clearTimeout(showTimer);
      showTimer = setTimeout(() => show(el), SHOW_DELAY);
    });
    el.addEventListener('mouseleave', () => { clearTimeout(showTimer); hide(); });
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', hide);
  }

  // Initial bind for elements present on load
  document.querySelectorAll('[data-tooltip]').forEach(bind);

  // Watch for newly-added [data-tooltip] elements (e.g. dynamically rendered table rows)
  new MutationObserver(records => {
    records.forEach(r => r.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.matches?.('[data-tooltip]')) bind(n);
      n.querySelectorAll?.('[data-tooltip]').forEach(bind);
    }));
  }).observe(document.body, { childList: true, subtree: true });

  // Hide on scroll/resize so position doesn't get stale
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();
