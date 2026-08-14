// Fluent UI Web Components v3 — theme bootstrap.
// Imports setTheme + Fluent 2 token presets via esm.sh (which bundles deps for the browser),
// applies the theme based on <html data-theme="light|dark">, and wires the topbar
// <fluent-switch id="theme-toggle"> to flip it.
import { setTheme } from 'https://esm.sh/@fluentui/web-components@3.0.0-rc.27';
import { webLightTheme, webDarkTheme } from 'https://esm.sh/@fluentui/tokens';

// Log which Fluent custom elements actually got registered so we can see in
// DevTools whether the bundle wired up fluent-dialog + fluent-dialog-body.
window.addEventListener('DOMContentLoaded', () => {
  const tags = ['fluent-button', 'fluent-text-input', 'fluent-textarea', 'fluent-dropdown', 'fluent-listbox', 'fluent-option', 'fluent-switch', 'fluent-badge', 'fluent-avatar', 'fluent-radio', 'fluent-spinner', 'fluent-dialog', 'fluent-dialog-body'];
  console.log('[fluent register status]', Object.fromEntries(tags.map(t => [t, !!customElements.get(t)])));
});

// If the bundle didn't register fluent-dialog or fluent-dialog-body, dynamic
// import their define modules at runtime (guarded so duplicate-define doesn't throw).
(async () => {
  if (!customElements.get('fluent-dialog')) {
    try { await import('https://esm.sh/@fluentui/web-components@3.0.0-rc.27/dist/esm/dialog/define.js'); }
    catch (e) { console.error('[fluent] dialog import failed', e); }
  }
  if (!customElements.get('fluent-dialog-body')) {
    try { await import('https://esm.sh/@fluentui/web-components@3.0.0-rc.27/dist/esm/dialog-body/define.js'); }
    catch (e) { console.error('[fluent] dialog-body import failed', e); }
  }
})();

const STORAGE_KEY = 'msstore.theme';

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function applyFluentTheme() {
  setTheme(currentTheme() === 'light' ? webLightTheme : webDarkTheme);
  syncThemeImages();
}

// Swap any <img data-theme-image="NAME"> between assets/NAME-light.png and assets/NAME-dark.png
function syncThemeImages() {
  const suffix = currentTheme() === 'light' ? 'light' : 'dark';
  document.querySelectorAll('img[data-theme-image]').forEach(img => {
    const base = img.dataset.themeImage;
    if (base) img.src = `assets/${base}-${suffix}.png`;
  });
}

function setTheme_(next) {
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
}

applyFluentTheme();

// React to external data-theme changes (e.g., another tab, devtools).
new MutationObserver(applyFluentTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

// Follow the OS/browser colour scheme and switch live when it changes. A change to the
// system setting takes over from a manual toggle choice, so the theme tracks the browser.
const schemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
function onSchemeChange(e) {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
  var toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.checked = !e.matches;
}
if (schemeMedia.addEventListener) schemeMedia.addEventListener('change', onSchemeChange);
else if (schemeMedia.addListener) schemeMedia.addListener(onSchemeChange);

// Wire the topbar theme switch once the DOM (and Fluent component definitions) are ready.
function wireToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  // Reflect current state into the switch (default: checked = light).
  toggle.checked = currentTheme() === 'light';
  toggle.addEventListener('change', () => {
    setTheme_(toggle.checked ? 'light' : 'dark');
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireToggle);
} else {
  wireToggle();
}

// ── Fluent dialog/drawer open fix ────────────────────────────────────────────
// On this build, <fluent-dialog>/<fluent-drawer> .show()/.hide() defer their work through FAST's
// update queue (Updates.enqueue), which isn't flushed here — so the methods silently no-op and the
// modal never opens. Drive the captured native <dialog> directly (showModal()/close()), which is
// reliable and still gives the backdrop, Esc-to-close and focus trap.
function patchNativeDialog(tag) {
  const ctor = customElements.get(tag);
  if (!ctor || ctor.prototype.__nativeOpenPatched) return !!ctor;
  const proto = ctor.prototype;
  proto.__nativeOpenPatched = true;
  proto.show = function () {
    const nd = this.dialog || (this.shadowRoot && this.shadowRoot.querySelector('dialog'));
    if (!nd || nd.open) return;
    try { nd.showModal(); } catch (_) { try { nd.show(); } catch (__) {} }
    if (!this.__closeWired) {
      this.__closeWired = true;
      nd.addEventListener('close', () => this.dispatchEvent(new CustomEvent('toggle', { detail: { newState: 'closed' } })));
    }
    this.dispatchEvent(new CustomEvent('toggle', { detail: { newState: 'open' } }));
  };
  proto.hide = function () {
    const nd = this.dialog || (this.shadowRoot && this.shadowRoot.querySelector('dialog'));
    if (nd && nd.open) nd.close();
  };
  return true;
}
['fluent-dialog', 'fluent-drawer'].forEach((tag) => {
  if (!patchNativeDialog(tag)) customElements.whenDefined(tag).then(() => patchNativeDialog(tag));
});
