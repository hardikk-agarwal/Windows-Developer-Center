'use strict';
// ============================================================================
// AI proxy — Azure Functions (v4 Node model).
//
// Forwards the browser's AI calls to Azure AI Foundry, injecting the key + model
// SERVER-SIDE so they never reach the client. This is what lets a static host
// (GitHub Pages) use real AI with no key in the repo or the browser.
//
// Endpoints (default route prefix is /api):
//   GET  /api/ai/status     -> { enabled, imageEnabled }
//   POST /api/ai/responses  -> Foundry Responses API (listing copy, ratings, translate)
//   POST /api/ai/images     -> Foundry image generations (optional)
//
// APP SETTINGS (Function App -> Configuration; NEVER commit these):
//   AZURE_AI_ENDPOINT        Responses URL (…/openai/responses?api-version=…)
//   AZURE_AI_KEY             Foundry key
//   AZURE_AI_MODEL           deployment name (e.g. gpt-5-mini)
//   AZURE_AI_IMAGE_ENDPOINT  (optional) image generations URL
//   AZURE_AI_IMAGE_MODEL     (optional) image deployment name
//   ALLOWED_ORIGINS          comma-separated browser origins allowed to call
//                            this proxy, e.g. "https://YOUR-ORG.github.io".
//                            (Same-origin hosts like Azure SWA can leave empty.)
//
// CORS is handled IN CODE below — leave the Function App's platform CORS setting
// EMPTY, or you'll get duplicate Access-Control-Allow-Origin headers.
//
// NOTE: this proxy is anonymous, so anyone with the URL can spend your AI quota
// (CORS only stops other *browsers*, not curl). It never leaks the key, but set
// an Azure spending cap, and for real protection front it with auth (App Service
// Authentication / Entra) or an API Management/rate-limit layer.
// ============================================================================
const { app } = require('@azure/functions');

const CREDS = {
  endpoint:      process.env.AZURE_AI_ENDPOINT       || '',
  apiKey:        process.env.AZURE_AI_KEY            || '',
  model:         process.env.AZURE_AI_MODEL          || '',
  imageEndpoint: process.env.AZURE_AI_IMAGE_ENDPOINT || '',
  imageModel:    process.env.AZURE_AI_IMAGE_MODEL    || '',
};
const READY     = !!(CREDS.endpoint && CREDS.apiKey && CREDS.model);
const IMG_READY = !!(CREDS.imageEndpoint && CREDS.apiKey && CREDS.imageModel);
const ALLOWED   = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

// Reflect the caller's Origin only when it's allow-listed (or "*" is set).
function corsHeaders(origin) {
  const h = { 'Cache-Control': 'no-store' };
  if (origin && (ALLOWED.indexOf('*') >= 0 || ALLOWED.indexOf(origin) >= 0)) {
    h['Access-Control-Allow-Origin']  = ALLOWED.indexOf('*') >= 0 ? '*' : origin;
    h['Vary']                          = 'Origin';
    h['Access-Control-Allow-Methods']  = 'GET,POST,OPTIONS';
    h['Access-Control-Allow-Headers']  = 'Content-Type';
    h['Access-Control-Max-Age']        = '600';
  }
  return h;
}
function jsonResponse(status, origin, obj) {
  return {
    status: status,
    headers: Object.assign({}, corsHeaders(origin), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(obj),
  };
}

app.http('aiStatus', {
  route: 'ai/status', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  handler: async function (req) {
    const origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') return { status: 204, headers: corsHeaders(origin) };
    return jsonResponse(200, origin, { enabled: READY, imageEnabled: IMG_READY });
  },
});

app.http('aiResponses', {
  route: 'ai/responses', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: function (req) { return proxy(req, 'text'); },
});

app.http('aiImages', {
  route: 'ai/images', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  handler: function (req) { return proxy(req, 'image'); },
});

// Forward to Foundry with the server-held key; pass the raw response back so the
// client parses it exactly as if it had called Foundry directly.
async function proxy(req, kind) {
  const origin   = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return { status: 204, headers: corsHeaders(origin) };

  const ready    = kind === 'image' ? IMG_READY : READY;
  const endpoint = kind === 'image' ? CREDS.imageEndpoint : CREDS.endpoint;
  const model    = kind === 'image' ? CREDS.imageModel : CREDS.model;
  if (!ready) return jsonResponse(503, origin, { error: 'AI not configured on server' });

  let body;
  try { body = await req.json(); }
  catch (e) { return jsonResponse(400, origin, { error: 'bad json' }); }
  body.model = model;                          // the server owns the deployment name

  let r;
  try {
    r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': CREDS.apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return jsonResponse(502, origin, { error: String((e && e.message) || e) });
  }
  const text = await r.text();
  return {
    status: r.status,
    headers: Object.assign({}, corsHeaders(origin), { 'Content-Type': 'application/json' }),
    body: text,
  };
}
