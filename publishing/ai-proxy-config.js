// ============================================================================
// ai-proxy-config.js — PUBLIC config for the AI proxy location. NO SECRETS.
//
// This file IS committed (unlike ai-config.js). It only ever holds a public URL
// — never an Azure key — so it is safe to ship on a static host like GitHub
// Pages. The key lives ONLY in the proxy's server-side app settings.
//
// HOW IT WORKS
//   - Local dev (node server.js) or Azure Static Web Apps: leave this EMPTY.
//     ai-client.js then calls the same-origin /api/ai/* proxy.
//   - GitHub Pages (or any static host with no server): set AI_PROXY_BASE to the
//     origin of your deployed serverless proxy (see /api — an Azure Functions
//     app). The browser calls <base>/api/ai/*, and the proxy injects the key.
//
// Example (after you deploy the /api Functions app):
//   window.AI_PROXY_BASE = 'https://udx-ai-proxy.azurewebsites.net';
//
// The proxy must allow this site's origin in ALLOWED_ORIGINS (see api/). If this
// is empty and there is no same-origin proxy, AI falls back to keyword heuristics.
// ============================================================================
window.AI_PROXY_BASE = '';
