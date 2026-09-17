(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./certificate-discovery.js'));
  else root.CertificateReview = factory(root.CertificateDiscovery);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (discovery) {
  'use strict';

  var ROLES = { review: 'Needs review', app: 'Suggested apps', helper: 'Helpers' };
  var ROLE_LABELS = { app: 'Main executable', helper: 'Helper executable', review: 'Needs review' };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"]/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]; }); }
  function icon(name, slot) { return '<iconify-icon' + (slot ? ' slot="' + slot + '"' : '') + ' icon="fluent:' + name + '-20-regular" width="20" height="20" aria-hidden="true"></iconify-icon>'; }
  function modeOptions(mode, bulk, storeManaged) {
    return (bulk ? '<fluent-option value="" selected>Change inclusion</fluent-option>' : '') + Object.keys(discovery.TRACKING_MODES).map(function (value) {
      return '<fluent-option value="' + value + '"' + (mode === value ? ' selected' : '') + (storeManaged && value === 'analytics' ? ' disabled' : '') + '>' + esc(discovery.TRACKING_MODES[value]) + '</fluent-option>';
    }).join('') + (bulk ? '<fluent-option value="recommended">Use recommendations</fluent-option>' : '');
  }
  function createState(candidates, context) {
    return { candidates: candidates.map(function (candidate, index) {
      var mode = discovery.trackingMode(candidate);
      return Object.assign({}, candidate, { index: index, mode: mode, initialMode: mode, selected: mode === 'app', initialSelected: mode === 'app', suggestedRole: candidate.suggestedRole || (candidate.recommended ? 'app' : 'review') });
    }), context: context || {}, query: '', role: 'all', mode: 'all', bulkEditing: false, filtersExpanded: false, pageSize: 25, pages: { app: 0, helper: 0, review: 0 },
      expanded: new Set(['app', 'review']), details: new Set(), marked: new Set(), saving: false };
  }
  function matches(review) { return discovery.view(review.candidates, { query: review.query, role: review.role, mode: review.mode, sort: 'name' }); }
  function pageItems(review, role) {
    var items = matches(review).filter(function (candidate) { return candidate.suggestedRole === role; });
    var totalPages = Math.max(1, Math.ceil(items.length / review.pageSize));
    review.pages[role] = Math.min(review.pages[role], totalPages - 1);
    return { items: items, shown: items.slice(review.pages[role] * review.pageSize, (review.pages[role] + 1) * review.pageSize), pages: totalPages };
  }
  function setMode(review, index, mode) {
    var candidate = review.candidates[index];
    if (!candidate || candidate.locked || (candidate.storeManaged && mode === 'analytics') || !Object.prototype.hasOwnProperty.call(discovery.TRACKING_MODES, mode)) return;
    candidate.mode = mode; candidate.selected = mode === 'app';
  }
  function applyBulk(review, mode) {
    review.marked.forEach(function (index) { setMode(review, index, mode === 'recommended' ? review.candidates[index].suggestedMode : mode); });
  }
  function setFilters(review, filters) {
    Object.assign(review, filters); review.pages = { app: 0, helper: 0, review: 0 }; review.marked.clear();
    review.expanded = new Set(review.query.trim() || review.role !== 'all' || review.mode !== 'all' ? Object.keys(ROLES) : ['app', 'review']);
  }
  function destination(review) { var counts = discovery.reviewCounts(review.candidates); return counts.apps ? 'apps' : counts.analyticsOnly ? 'analytics' : 'close'; }
  function saveActions(review) {
    var target = destination(review), viewLabel = target === 'apps' ? 'Save and view apps' : 'Save and view analytics';
    var stay = review.context.managing || target === 'close';
    return { primary: { label: stay ? 'Save changes' : viewLabel, destination: stay ? 'close' : target },
      secondary: target === 'close' ? null : { label: stay ? viewLabel : 'Save and close', destination: stay ? target : 'close' } };
  }
  function changed(review) { return review.candidates.some(function (candidate) { return discovery.trackingMode(candidate) !== candidate.initialMode; }); }
  function summaryHTML(review) {
    var counts = discovery.reviewCounts(review.candidates);
    return '<span><strong>' + counts.apps.toLocaleString() + '</strong> app' + (counts.apps === 1 ? '' : 's') + '</span>' +
      (counts.analyticsOnly ? '<span><strong>' + counts.analyticsOnly.toLocaleString() + '</strong> analytics-only executable' + (counts.analyticsOnly === 1 ? '' : 's') + '</span>' : '') +
      (counts.excluded ? '<span>' + counts.excluded.toLocaleString() + ' not included</span>' : '');
  }
  function detailsHTML(candidate) {
    var fields = [['Recommendation', candidate.trackingReason || candidate.reason], ['Path', candidate.path || 'Not available'],
      ['Version', candidate.version || 'Not available'], ['Certificate', candidate.certName]];
    return '<dl class="cr-details">' + fields.filter(function (field) { return field[1]; }).map(function (field) {
      return '<div><dt>' + field[0] + '</dt><dd>' + esc(field[1]) + '</dd></div>';
    }).join('') + (candidate.missingFromScan ? '<div><dt>Discovery</dt><dd>Previously saved; not returned by this scan.</dd></div>' : '') + '</dl>';
  }
  function rowHTML(candidate, review, appIcon) {
    var open = review.details.has(candidate.index), mode = discovery.trackingMode(candidate), columns = review.bulkEditing ? 4 : 3;
    var meta = [candidate.file, candidate.product && candidate.product !== candidate.name ? candidate.product : ''].filter(Boolean).join(' / ');
    var targetChange = candidate.relinkId || candidate.relinkTargetId;
    return '<tr data-cr-row="' + candidate.index + '">' +
      (review.bulkEditing ? '<td class="cr-select-cell"><fluent-checkbox data-cr-mark="' + candidate.index + '" aria-label="' + esc('Select ' + candidate.name + ' for bulk changes') + '"' + (review.marked.has(candidate.index) ? ' checked' : '') + (candidate.locked ? ' disabled' : '') + '></fluent-checkbox></td>' : '') +
      '<td><div class="cr-executable">' + (appIcon ? appIcon(candidate) : icon('document')) + '<div><fluent-button class="cr-name" appearance="transparent" data-cr-details="' + candidate.index + '" aria-expanded="' + open + '" aria-controls="cr-details-' + candidate.index + '" aria-label="' + esc((open ? 'Hide' : 'Show') + ' details for ' + candidate.name) + '" title="Executable details"><strong>' + esc(candidate.name) + '</strong></fluent-button><span>' + esc(meta || 'Executable') + '</span>' +
        (targetChange ? '<span class="cr-relink">Selecting this moves its tracking to this certificate.</span>' : '') + '</div></div></td>' +
      '<td class="cr-role-cell">' + (ROLE_LABELS[candidate.suggestedRole] || ROLE_LABELS.review) + '</td>' +
      '<td class="cr-mode-cell"><fluent-dropdown class="cr-mode" data-cr-mode="' + candidate.index + '" appearance="outline" aria-label="' + esc('Include ' + candidate.name + ' in') + '"' + (candidate.locked ? ' disabled' : '') + '><fluent-listbox>' + modeOptions(mode, false, candidate.storeManaged) + '</fluent-listbox></fluent-dropdown></td></tr>' +
      (open ? '<tr class="cr-detail-row" id="cr-details-' + candidate.index + '"><td colspan="' + columns + '">' + detailsHTML(candidate) + '</td></tr>' : '');
  }
  function resultsHTML(review, appIcon) {
    var filtered = matches(review);
    if (!filtered.length) return '<div class="cr-empty" role="status">' + icon('search') + '<strong>' + (review.candidates.length ? 'No matching executables' : 'No executables found') + '</strong>' +
      '<p>' + (review.candidates.length ? 'No executables match the current filters.' : 'Your certificate is saved. You can check again later.') + '</p>' +
      (review.candidates.length ? '<fluent-button appearance="outline" data-cr-clear-filters>Clear filters</fluent-button>' : '') + '</div>';
    return Object.keys(ROLES).map(function (role) {
      var group = pageItems(review, role), open = review.expanded.has(role);
      if (!group.items.length) return '';
      var eligible = group.shown.filter(function (candidate) { return !candidate.locked; });
      var selected = eligible.filter(function (candidate) { return review.marked.has(candidate.index); }).length;
      var heading = '<fluent-button appearance="transparent" data-cr-toggle="' + role + '" aria-expanded="' + open + '" aria-controls="cr-group-' + role + '">' + icon(open ? 'chevron-down' : 'chevron-right', 'start') + ROLES[role] + ' <span class="cr-count">' + group.items.length.toLocaleString() + '</span></fluent-button>';
      var rows = '', product = '', columns = review.bulkEditing ? 4 : 3;
      if (open) group.shown.forEach(function (candidate) {
        if (candidate.applicationKey && candidate.applicationKey !== product) {
          rows += '<tr class="cr-product"><td colspan="' + columns + '">' + esc(candidate.product || candidate.name) + '</td></tr>';
        }
        product = candidate.applicationKey || '';
        rows += rowHTML(candidate, review, appIcon);
      });
      return '<section class="cr-group"><header>' + heading + '</header>' +
        '<div id="cr-group-' + role + '"' + (open ? '' : ' hidden') + '>' + (open ? '<div class="cr-table-scroll"><table class="table cr-table' + (review.bulkEditing ? ' cr-table--bulk' : '') + '"><thead><tr>' +
          (review.bulkEditing ? '<th class="cr-select-cell"><fluent-checkbox data-cr-page-select="' + role + '" aria-label="Select this page of ' + esc(ROLES[role].toLowerCase()) + '"' + (eligible.length && selected === eligible.length ? ' checked' : '') + (!eligible.length ? ' disabled' : '') + '></fluent-checkbox></th>' : '') +
          '<th>Executable</th><th class="cr-role-cell">Suggested role</th><th class="cr-mode-cell">Include in</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          (group.pages > 1 ? '<div class="cr-pagination"><span>' + (review.pages[role] * review.pageSize + 1) + '-' + Math.min((review.pages[role] + 1) * review.pageSize, group.items.length) + ' of ' + group.items.length + ' executables</span><span>Page ' + (review.pages[role] + 1) + ' of ' + group.pages + '</span>' +
          '<fluent-button appearance="transparent" icon-only data-cr-page="' + (review.pages[role] - 1) + '" data-cr-role="' + role + '" aria-label="Previous page of ' + esc(ROLES[role].toLowerCase()) + '" title="Previous page"' + (review.pages[role] === 0 ? ' disabled' : '') + '>' + icon('chevron-left') + '</fluent-button>' +
          '<fluent-button appearance="transparent" icon-only data-cr-page="' + (review.pages[role] + 1) + '" data-cr-role="' + role + '" aria-label="Next page of ' + esc(ROLES[role].toLowerCase()) + '" title="Next page"' + (review.pages[role] + 1 >= group.pages ? ' disabled' : '') + '>' + icon('chevron-right') + '</fluent-button></div>' : '') : '') + '</div></section>';
    }).join('');
  }
  function mount(host, options) {
    var review = createState(options.candidates, options.context), controller = new AbortController(), disposed = false;
    var context = review.context;
    host.innerHTML = '<div class="cr-workspace"><div class="block__head cr-heading"><fluent-button class="cr-back" appearance="transparent" icon-only data-cr-close aria-label="Back" title="Back">' + icon('arrow-left') + '</fluent-button>' +
      '<div><h1 tabindex="-1">Review apps and crash analytics</h1><p class="muted">' + esc((context.certs || []).map(function (cert) { return cert.label; }).join(', ')) + ' / ' + review.candidates.length.toLocaleString() + ' executables identified</p></div></div>' +
      '<div class="cr-error" role="alert" hidden></div>' +
      (context.errors?.length ? '<fluent-message-bar intent="warning" class="cr-warning">Results could not be loaded for ' + esc(context.errors.join(', ')) + '. Previously tracked executables are retained.<fluent-button slot="actions" appearance="outline" data-cr-retry>Try again</fluent-button></fluent-message-bar>' : '') +
      (context.countWarning ? '<p class="cr-warning">' + esc(context.countWarning) + '</p>' : '') +
      '<div class="cr-toolbar"><fluent-text-input id="crSearch" appearance="outline" placeholder="Search name, file or path" aria-label="Search executables">' + icon('search', 'start') + '</fluent-text-input>' +
        '<fluent-button appearance="transparent" data-cr-filters aria-expanded="false" aria-controls="crFilters"></fluent-button>' +
        '<fluent-button appearance="transparent" data-cr-bulk-edit aria-pressed="false"></fluent-button></div>' +
      '<div class="cr-filters" id="crFilters" hidden>' +
        '<fluent-dropdown id="crRoleFilter" appearance="outline" aria-label="Filter suggested role"><fluent-listbox><fluent-option value="all" selected>All roles</fluent-option>' + Object.keys(ROLES).map(function (role) { return '<fluent-option value="' + role + '">' + ROLES[role] + '</fluent-option>'; }).join('') + '</fluent-listbox></fluent-dropdown>' +
        '<fluent-dropdown id="crModeFilter" appearance="outline" aria-label="Filter inclusion"><fluent-listbox><fluent-option value="all" selected>All inclusion settings</fluent-option>' + modeOptions('') + '</fluent-listbox></fluent-dropdown>' +
        '<fluent-button appearance="transparent" data-cr-clear-filters>Clear filters</fluent-button></div>' +
      '<div class="cr-bulk" hidden><span class="cr-marked" role="status"></span><fluent-button appearance="transparent" data-cr-select-all></fluent-button><fluent-button appearance="transparent" data-cr-clear-selection>Clear selection</fluent-button>' +
        '<fluent-dropdown id="crBulkMode" appearance="outline" aria-label="Change inclusion for selected executables"><fluent-listbox>' + modeOptions('', true) + '</fluent-listbox></fluent-dropdown></div>' +
      '<div class="cr-results"></div></div>' +
      '<footer class="cr-footer"><div class="cr-footer-status"><div class="cr-summary" aria-live="polite" aria-atomic="true"></div><p>New crash reports can take up to 24 hours after saving.</p></div>' +
        '<div class="cr-footer-actions"><fluent-button appearance="transparent" data-cr-close>' + (context.managing ? 'Cancel' : 'Select later') + '</fluent-button>' +
          '<div class="cr-save-group" role="group" aria-label="Save tracking"><fluent-button appearance="primary" data-cr-save="primary"></fluent-button>' +
            '<fluent-menu id="crSaveMenu"><fluent-menu-button slot="trigger" id="crSaveMore" appearance="primary" aria-label="More save options" title="More save options">' + icon('chevron-down') + '<span slot="end"></span></fluent-menu-button>' +
              '<fluent-menu-list><fluent-menu-item data-cr-save="secondary"></fluent-menu-item></fluent-menu-list></fluent-menu></div></div></footer>';
    function sync() {
      host.querySelector('.cr-summary').innerHTML = summaryHTML(review);
      var filterCount = Number(review.role !== 'all') + Number(review.mode !== 'all');
      var filterButton = host.querySelector('[data-cr-filters]');
      filterButton.innerHTML = icon('filter', 'start') + 'Filters' + (filterCount ? ' (' + filterCount + ')' : '');
      filterButton.setAttribute('aria-expanded', String(review.filtersExpanded));
      host.querySelector('#crFilters').hidden = !review.filtersExpanded;
      host.querySelector('#crFilters [data-cr-clear-filters]').hidden = !filterCount && !review.query;
      var bulkButton = host.querySelector('[data-cr-bulk-edit]');
      bulkButton.innerHTML = icon(review.bulkEditing ? 'checkmark' : 'edit', 'start') + (review.bulkEditing ? 'Done' : 'Edit multiple');
      bulkButton.setAttribute('aria-pressed', String(review.bulkEditing));
      bulkButton.toggleAttribute('disabled', !review.candidates.some(function (candidate) { return !candidate.locked; }));
      host.querySelector('.cr-toolbar').hidden = !review.candidates.length;
      host.querySelector('.cr-bulk').hidden = !review.bulkEditing;
      var filtered = matches(review).filter(function (candidate) { return !candidate.locked; });
      host.querySelector('.cr-marked').textContent = review.marked.size + ' selected';
      var all = host.querySelector('[data-cr-select-all]'); all.textContent = 'Select all ' + filtered.length.toLocaleString() + ' matching';
      all.hidden = !review.marked.size || filtered.every(function (candidate) { return review.marked.has(candidate.index); });
      host.querySelector('[data-cr-clear-selection]').hidden = !review.marked.size;
      host.querySelector('#crBulkMode').toggleAttribute('disabled', !review.marked.size);
      var actions = saveActions(review);
      host.querySelector('[data-cr-save="primary"]').textContent = actions.primary.label;
      host.querySelector('[data-cr-save="secondary"]').textContent = actions.secondary ? actions.secondary.label : '';
      host.querySelector('#crSaveMenu').hidden = !actions.secondary;
      host.querySelectorAll('[data-cr-save], #crSaveMore').forEach(function (button) { button.toggleAttribute('disabled', review.saving || !review.candidates.length || (!!context.managing && !changed(review))); });
    }
    function render(focusSelector) {
      host.querySelector('.cr-results').innerHTML = resultsHTML(review, options.appIcon);
      Object.keys(ROLES).forEach(function (role) {
        var checkbox = host.querySelector('[data-cr-page-select="' + role + '"]');
        if (!checkbox) return;
        var eligible = pageItems(review, role).shown.filter(function (candidate) { return !candidate.locked; });
        checkbox.indeterminate = eligible.some(function (candidate) { return review.marked.has(candidate.index); }) && !eligible.every(function (candidate) { return review.marked.has(candidate.index); });
      });
      sync();
      if (focusSelector) requestAnimationFrame(function () {
        var element = !disposed && (host.querySelector(focusSelector) || host.querySelector(review.filtersExpanded ? '#crModeFilter' : '[data-cr-filters]'));
        var control = element && (element.querySelector('[role="combobox"]') || element.shadowRoot?.querySelector('[role="combobox"], button, input'));
        if (element) HTMLElement.prototype.focus.call(control || element, { preventScroll: true });
      });
    }
    host.addEventListener('input', function (event) {
      if (event.target.id === 'crSearch') { setFilters(review, { query: event.target.value || '' }); render(); }
    }, { signal: controller.signal });
    host.addEventListener('change', function (event) {
      var element = event.target, row = element.closest('[data-cr-mode]'), mark = element.closest('[data-cr-mark]'), page = element.closest('[data-cr-page-select]');
      if (row && row.value) {
        setMode(review, +row.dataset.crMode, row.value);
        if (review.mode !== 'all' && discovery.trackingMode(review.candidates[+row.dataset.crMode]) !== review.mode) {
          queueMicrotask(function () { if (!disposed) render('[data-cr-mode]:not([disabled])'); });
        } else sync();
      }
      else if (mark) { if (mark.checked) review.marked.add(+mark.dataset.crMark); else review.marked.delete(+mark.dataset.crMark); render('[data-cr-mark="' + mark.dataset.crMark + '"]'); }
      else if (page) { pageItems(review, page.dataset.crPageSelect).shown.forEach(function (candidate) { if (!candidate.locked) { if (page.checked) review.marked.add(candidate.index); else review.marked.delete(candidate.index); } }); render('[data-cr-page-select="' + page.dataset.crPageSelect + '"]'); }
      else if (element.id === 'crRoleFilter') { setFilters(review, { role: element.value || 'all' }); render(); }
      else if (element.id === 'crModeFilter') { setFilters(review, { mode: element.value || 'all' }); render(); }
      else if (element.id === 'crBulkMode' && element.value) { applyBulk(review, element.value); render(); element.value = ''; }
    }, { signal: controller.signal });
    host.addEventListener('click', async function (event) {
      var element = event.target.closest('fluent-button, fluent-menu-item'); if (!element || element.hasAttribute('disabled') || review.saving) return;
      if (element.hasAttribute('data-cr-close')) { options.onClose(); return; }
      if (element.hasAttribute('data-cr-retry')) { options.onRetry(); return; }
      if (element.hasAttribute('data-cr-filters')) { review.filtersExpanded = !review.filtersExpanded; sync(); return; }
      if (element.hasAttribute('data-cr-bulk-edit')) { review.bulkEditing = !review.bulkEditing; review.marked.clear(); render('[data-cr-bulk-edit]'); return; }
      if (element.hasAttribute('data-cr-toggle')) { var role = element.dataset.crToggle; if (review.expanded.has(role)) review.expanded.delete(role); else review.expanded.add(role); render('[data-cr-toggle="' + role + '"]'); }
      else if (element.hasAttribute('data-cr-details')) { var index = +element.dataset.crDetails; if (review.details.has(index)) review.details.delete(index); else review.details.add(index); render('[data-cr-details="' + index + '"]'); }
      else if (element.hasAttribute('data-cr-page')) { review.pages[element.dataset.crRole] = +element.dataset.crPage; render('[data-cr-toggle="' + element.dataset.crRole + '"]'); }
      else if (element.hasAttribute('data-cr-select-all')) { matches(review).forEach(function (candidate) { if (!candidate.locked) review.marked.add(candidate.index); }); render(); }
      else if (element.hasAttribute('data-cr-clear-selection')) { review.marked.clear(); render(); }
      else if (element.hasAttribute('data-cr-clear-filters')) { setFilters(review, { query: '', role: 'all', mode: 'all' }); host.querySelector('#crSearch').value = ''; host.querySelector('#crRoleFilter').value = 'all'; host.querySelector('#crModeFilter').value = 'all'; render(); }
      else if (element.hasAttribute('data-cr-save')) {
        review.saving = true; sync();
        var error = host.querySelector('.cr-error'); error.hidden = true;
        try {
          var action = saveActions(review)[element.dataset.crSave];
          if (!action) return;
          var result = await options.onSave(review.candidates, action.destination);
          if (!disposed && result?.error) { error.textContent = result.error; error.hidden = false; error.tabIndex = -1; error.focus(); }
        } catch (_) { if (!disposed) { error.textContent = 'We could not save your selections. Try again.'; error.hidden = false; } }
        finally { review.saving = false; if (!disposed) sync(); }
      }
    }, { signal: controller.signal });
    render();
    return { state: review, dispose: function () { disposed = true; controller.abort(); host.innerHTML = ''; } };
  }

  return { createState: createState, matches: matches, pageItems: pageItems, setMode: setMode, applyBulk: applyBulk,
    setFilters: setFilters, destination: destination, saveActions: saveActions, changed: changed, summaryHTML: summaryHTML, resultsHTML: resultsHTML, mount: mount };
});