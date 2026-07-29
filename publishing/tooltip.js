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
    const vw = window.innerWidth, vh = window.innerHeight;
    const placement = el.getAttribute('data-tooltip-placement');

    // Opt-in vertical placement (data-tooltip-placement="top" | "bottom"): centered above/below the
    // element, flipping to the other side if there's no room. Better for icons inside horizontal
    // controls, where a right-side tooltip would overlap neighbouring items.
    if (placement === 'top' || placement === 'bottom') {
      let left = r.left + r.width / 2 - tt.width / 2;
      left = Math.max(8, Math.min(left, vw - tt.width - 8));
      let top = placement === 'bottom' ? r.bottom + GAP : r.top - tt.height - GAP;
      if (placement === 'bottom' && top + tt.height > vh - 8) top = r.top - tt.height - GAP;
      if (placement === 'top' && top < 8) top = r.bottom + GAP;
      tooltip.style.left = left + 'px';
      tooltip.style.top  = Math.max(8, top) + 'px';
      return;
    }

    // Default: prefer right of element; flip to left if it would overflow
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
