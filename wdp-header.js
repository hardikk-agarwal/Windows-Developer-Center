/* Windows Developer Center — shared header brand lockup (single source of truth).
   Fills every <a class="brand" data-wdp-brand> across all pages with the
   "Microsoft | Windows Developer Center" lockup, so the brand name, logo, and
   accessible label live in ONE place. Each page keeps its own header shell,
   right-side content, and the brand link's href. Change the name/logo here once
   and it updates the portal, the Store portal, the publishing flow, and the
   certification report together. */
(function () {
  "use strict";
  var NAME = "Microsoft";
  var SUB = "Windows Developer Center";
  var INNER =
    '<svg class="brand__logo" width="20" height="20" viewBox="0 0 23 23" aria-hidden="true">' +
      '<rect x="1" y="1" width="10" height="10" fill="#F25022"/>' +
      '<rect x="12" y="1" width="10" height="10" fill="#7FBA00"/>' +
      '<rect x="1" y="12" width="10" height="10" fill="#00A4EF"/>' +
      '<rect x="12" y="12" width="10" height="10" fill="#FFB900"/>' +
    '</svg>' +
    '<span class="brand__name">' + NAME + '</span>' +
    '<span class="brand__divider" aria-hidden="true"></span>' +
    '<span class="brand__sub">' + SUB + '</span>';

  function fill() {
    var nodes = document.querySelectorAll('a.brand[data-wdp-brand]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-wdp-filled')) continue;
      nodes[i].innerHTML = INNER;
      nodes[i].setAttribute('aria-label', NAME + " " + SUB);
      nodes[i].setAttribute('data-wdp-filled', '1');
    }
  }

  // Run immediately for brand anchors already parsed (the script is placed right
  // after the header), then again on DOMContentLoaded as a safety net.
  fill();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
})();
