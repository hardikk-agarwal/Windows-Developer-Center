// Windows Developer Center — shared Fluent 2 theme controller for the root pages
// (portal, signup, store-portal, marketing). Single source of truth for light/dark:
//   • applies the Fluent 2 theme with setTheme(webLightTheme|webDarkTheme) from <html data-theme>
//   • swaps <img data-theme-image="NAME"> between assets/NAME-light.png and assets/NAME-dark.png
//     (falls back to assets/NAME.png if a themed variant is missing)
//   • wires a topbar #theme-toggle button (sun in dark → switch to light, moon in light → switch to dark)
//   • persists the choice in localStorage 'msstore.theme' (shared with the publishing flow)
// The initial data-theme is set by a tiny inline <head> script on each page to avoid a flash.
import { setTheme } from 'https://esm.sh/@fluentui/web-components@3.0.0-rc.27';
import { webLightTheme, webDarkTheme } from 'https://esm.sh/@fluentui/tokens';

const STORAGE_KEY = 'msstore.theme';
const current = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

// Swap themed images. Idempotent — only touches an <img> whose src isn't already correct.
function syncThemeImages(root) {
  const suffix = current();
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('img[data-theme-image]').forEach((img) => {
    const base = img.dataset.themeImage;
    if (!base) return;
    const want = `assets/${base}-${suffix}.png`;
    if (img.getAttribute('src') === want) return;
    // Fall back to the theme-agnostic base file if the themed variant fails to load.
    img.onerror = () => { img.onerror = null; img.src = `assets/${base}.png`; };
    img.src = want;
  });
}

function applyTheme() {
  setTheme(current() === 'light' ? webLightTheme : webDarkTheme);
  syncThemeImages(document);
  syncToggle();
}

function setThemeValue(next) {
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
}

function syncToggle() {
  const t = document.getElementById('theme-toggle');
  if (!t) return;
  const isLight = current() === 'light';
  const label = isLight ? 'Switch to dark theme' : 'Switch to light theme';
  t.setAttribute('aria-label', label);
  t.setAttribute('aria-pressed', String(isLight));
  t.title = label;
  const ic = t.querySelector('iconify-icon');
  if (ic) ic.setAttribute('icon', isLight ? 'fluent:weather-moon-20-regular' : 'fluent:weather-sunny-20-regular');
}

applyTheme();

// React to data-theme changes (toggle, other tabs, devtools).
new MutationObserver(applyTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

// Follow the OS/browser colour scheme and switch live when it changes. A change to the
// system setting takes over from a manual toggle choice, so the theme tracks the browser.
const schemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
function onSchemeChange(e) {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
}
if (schemeMedia.addEventListener) schemeMedia.addEventListener('change', onSchemeChange);
else if (schemeMedia.addListener) schemeMedia.addListener(onSchemeChange);

// Catch dynamically-rendered illustrations (portal.js re-renders views) — debounced.
let pending = false;
new MutationObserver(() => {
  if (pending) return;
  pending = true;
  Promise.resolve().then(() => { pending = false; syncThemeImages(document); });
}).observe(document.documentElement, { childList: true, subtree: true });

function wireToggle() {
  const t = document.getElementById('theme-toggle');
  if (!t) return;
  t.addEventListener('click', () => setThemeValue(current() === 'light' ? 'dark' : 'light'));
  syncToggle();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireToggle);
else wireToggle();

// Expose for any code that renders illustrations imperatively.
window.syncThemeImages = () => syncThemeImages(document);

// ── Fluent dialog/drawer open fix ────────────────────────────────────────────
// On this build, <fluent-dialog>/<fluent-drawer> .show()/.hide() defer their work through FAST's
// update queue (Updates.enqueue), which isn't flushed here — so the methods silently no-op and the
// modal never opens. Drive the captured native <dialog> directly (showModal()/close()), which is
// reliable and still gives the backdrop, Esc-to-close and focus trap. Re-dispatch a `toggle` event
// (portal.js listens for newState:'closed' to reset dialog state).
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
