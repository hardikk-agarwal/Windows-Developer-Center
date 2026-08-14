// ============================================================================
// ai-client.js — Azure AI Foundry Responses API client for the publishing flow.
//
// All "AI" work in the prototype routes through this module:
//   - aiGenerateListing()      — Step 2 listing copy
//   - aiInferContentAnswers()  — Step 3 IARC rating inference (structured)
//   - aiTranslate()            — Manage languages dialog auto-translation
//
// CREDENTIALS live in ai-config.js (gitignored). To set up:
//   1. Copy ai-config.template.js → ai-config.js
//   2. Fill in your endpoint, key, and model
//
// If ai-config.js is missing OR enabled=false OR fields are blank, every AI
// call falls back to the local keyword heuristics. The prototype stays usable.
//
// SECURITY: When configured, the key sits in client JS. Local prototype only.
// For production, route via a server-side proxy so the key never reaches the
// browser. Foundry CORS settings must include your dev origin for direct calls.
// ============================================================================

// Resolve config from window.AI_CONFIG (set by ai-config.js). Anything missing
// is treated as "AI off" and consumers will catch the thrown error and fall
// back to the local heuristic path.
const AI_CONFIG = Object.freeze({
  endpoint:      window.AI_CONFIG?.endpoint      || '',
  apiKey:        window.AI_CONFIG?.apiKey        || '',
  model:         window.AI_CONFIG?.model         || '',
  imageEndpoint: window.AI_CONFIG?.imageEndpoint || '',
  imageModel:    window.AI_CONFIG?.imageModel    || '',
  enabled:       !!(window.AI_CONFIG?.enabled && window.AI_CONFIG?.endpoint && window.AI_CONFIG?.apiKey && window.AI_CONFIG?.model),
  imageEnabled:  !!(window.AI_CONFIG?.enabled && window.AI_CONFIG?.imageEndpoint && window.AI_CONFIG?.imageModel && window.AI_CONFIG?.apiKey),
});

// Base URL for the AI proxy, overridable for STATIC hosts (e.g. GitHub Pages)
// that have no same-origin server. ai-proxy-config.js sets window.AI_PROXY_BASE
// to a deployed serverless proxy origin that holds the key server-side. This is
// a PUBLIC URL, never a secret. Empty = same-origin (node server.js / SWA api).
const AI_PROXY_BASE = String(window.AI_PROXY_BASE || '').replace(/\/+$/, '');
function aiProxyUrl(path) { return AI_PROXY_BASE + path; }

if (!AI_CONFIG.enabled) {
  console.info('[ai-client] No embedded AI key — will check the server /api/ai proxy; falls back to keyword heuristics if neither is configured.');
}

// ---------------------------------------------------------------------------
// Low-level Responses API call.
// ---------------------------------------------------------------------------
async function callResponses({ system, user, schema, maxOutputTokens = 4000, reasoningEffort = 'medium' }) {
  // AI runs either directly (browser has an embedded key) or via the same-origin
  // /api/ai proxy (server holds the key). Callers gate on window.AI.enabled.

  // Responses API: `input` is a plain string (user message), `instructions`
  // carries the system-level guidance. (Array-of-messages form needs typed
  // items per element; string + instructions is simpler and works the same.)
  const body = {
    model: AI_CONFIG.model,
    input: user,
    // GPT-5-mini is a reasoning model — internal reasoning tokens are deducted
    // from this budget before any visible output. A too-low cap can leave 0
    // tokens for the actual answer. Keep this generous.
    max_output_tokens: maxOutputTokens,
    // 'low' for simple tasks (translation, plain copy); 'medium' for tasks
    // that benefit from a bit of planning (structured listings, ratings).
    reasoning: { effort: reasoningEffort },
  };
  if (system) body.instructions = system;

  // Structured output via JSON schema. Strict mode forces the model to emit
  // valid JSON matching the schema (no prose around it).
  if (schema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: schema.name,
        schema: schema.schema,
        strict: true,
      },
    };
  }

  const res = await fetch(AI_CONFIG.enabled ? AI_CONFIG.endpoint : aiProxyUrl('/api/ai/responses'), {
    method: 'POST',
    headers: AI_CONFIG.enabled
      ? { 'Content-Type': 'application/json', 'api-key': AI_CONFIG.apiKey }
      : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI ${res.status}: ${detail.slice(0, 400)}`);
  }

  const json = await res.json();
  // Responses API: prefer the convenience output_text, fall back to walking output[].
  if (typeof json.output_text === 'string' && json.output_text.length) {
    return json.output_text;
  }
  const text = (json.output || [])
    .flatMap(o => o.content || [])
    .map(c => c.text || '')
    .join('');
  if (!text) throw new Error('AI returned empty output');
  return text;
}

// ---------------------------------------------------------------------------
// Listing copy generation.
// Returns: { category, subcategory, shortDescription, fullDescription, keywords[] }
// ---------------------------------------------------------------------------
const CATEGORY_VALUES = [
  'productivity', 'utilities', 'entertainment', 'developer-tools', 'education',
  'lifestyle', 'music', 'photo-video', 'social', 'business',
  'games-action', 'games-puzzle',
];

async function aiGenerateListing({ appName, pitch, features, audience, tone, packageType }) {
  const system = `You write Microsoft Store listings for Windows apps. Output marketing copy that is concise, benefit-led, and free of marketing fluff. Match the requested tone.`;
  const user = [
    `App name: ${appName}`,
    `Package type: ${packageType || 'MSIX'}`,
    `One-line pitch: ${pitch}`,
    features ? `Key features:\n${features}` : null,
    `Target audience: ${audience || 'general'}`,
    `Tone: ${tone || 'friendly'}`,
    '',
    `Write a Microsoft Store listing for this app. Pick the single best category from this allowed list:`,
    CATEGORY_VALUES.map(c => `- ${c}`).join('\n'),
    `Pick a brief subcategory label that fits inside the chosen category (free-form, 1-3 words).`,
    `Short description: one line, under 270 characters, no marketing fluff.`,
    `Full description: 2-3 short paragraphs that explain the app's value. Do NOT include a bulleted feature list here — features are returned separately.`,
    `Features: 4-6 short benefit-led bullets (3-8 words each). No leading bullet character — just the text.`,
    `Keywords: 6-8 lowercase search terms a user might type to find this app.`,
  ].filter(Boolean).join('\n');

  const schema = {
    name: 'store_listing',
    schema: {
      type: 'object',
      properties: {
        category:         { type: 'string', enum: CATEGORY_VALUES },
        subcategory:      { type: 'string' },
        shortDescription: { type: 'string', maxLength: 270 },
        fullDescription:  { type: 'string' },
        features:         { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
        keywords:         { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 8 },
      },
      required: ['category', 'subcategory', 'shortDescription', 'fullDescription', 'features', 'keywords'],
      additionalProperties: false,
    },
  };

  // Speed matters here — the developer is watching a "Writing…" spinner. GPT-5-mini is a reasoning
  // model, so reasoning effort is the biggest latency lever; listing copy doesn't need deep planning,
  // so 'low' roughly halves the wait with no meaningful quality loss. The token cap only bounds the
  // output (it doesn't add latency), but keep it comfortably above a full listing so JSON never truncates.
  const text = await callResponses({ system, user, schema, maxOutputTokens: 3000, reasoningEffort: 'low' });
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// IARC content rating inference.
// Returns the answer object matching the dialog's data model:
//   { violence, sexual, language, substances, gambling, userInteraction, inAppPurchases }
// ---------------------------------------------------------------------------
async function aiInferContentAnswers({ category, shortDesc, fullDesc, keywords }) {
  const system = `You assess Microsoft Store app content for IARC-style age rating. Be conservative: pick the lowest level that honestly fits the described content. Don't infer content that isn't supported by the description.`;
  const user = [
    `Category: ${category || '(unknown)'}`,
    `Short description: ${shortDesc || '(none)'}`,
    `Full description: ${fullDesc || '(none)'}`,
    `Keywords: ${(keywords || []).join(', ') || '(none)'}`,
    '',
    `For each dimension, pick exactly one level. Choose "none" unless the description clearly indicates the higher level.`,
  ].join('\n');

  const schema = {
    name: 'content_rating',
    schema: {
      type: 'object',
      properties: {
        violence:        { type: 'string', enum: ['none', 'cartoon', 'realistic', 'graphic'] },
        sexual:          { type: 'string', enum: ['none', 'suggestive', 'nudity', 'explicit'] },
        language:        { type: 'string', enum: ['none', 'mild', 'strong'] },
        substances:      { type: 'string', enum: ['none', 'reference', 'use'] },
        gambling:        { type: 'string', enum: ['none', 'simulated', 'realmoney'] },
        userInteraction: { type: 'boolean' },
        inAppPurchases:  { type: 'boolean' },
      },
      required: ['violence', 'sexual', 'language', 'substances', 'gambling', 'userInteraction', 'inAppPurchases'],
      additionalProperties: false,
    },
  };

  // Tiny output (7 enum fields) but reasoning matters here — model needs to
  // think about whether description implies violence/adult/etc. Medium effort.
  const text = await callResponses({ system, user, schema, maxOutputTokens: 2000 });
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Translation. Returns the translated string.
// ---------------------------------------------------------------------------
async function aiTranslate({ text, fromLocale, toLocale }) {
  if (!text || !text.trim()) return text;
  const system = `You translate Microsoft Store listing copy between locales. Preserve marketing tone, line breaks, and bullet markers. Output only the translation — no commentary, no quotes.`;
  const user = `Translate from ${fromLocale} to ${toLocale}:\n\n${text}`;
  // Translation is mechanical — low reasoning effort keeps it fast + cheap.
  const out = await callResponses({ system, user, maxOutputTokens: 4000, reasoningEffort: 'low' });
  return out.trim();
}

// Convenience: translate a list of keywords in one call.
async function aiTranslateKeywords({ keywords, fromLocale, toLocale }) {
  if (!keywords?.length) return [];
  const system = `You translate Microsoft Store search keywords between locales. Keep them lowercase, short, and search-friendly. Output a JSON array of strings only.`;
  const user = `Translate these keywords from ${fromLocale} to ${toLocale}:\n${JSON.stringify(keywords)}`;
  const schema = {
    name: 'translated_keywords',
    schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' } },
      },
      required: ['keywords'],
      additionalProperties: false,
    },
  };
  const text = await callResponses({ system, user, schema, maxOutputTokens: 2000, reasoningEffort: 'low' });
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.keywords) ? parsed.keywords : keywords;
}

// ---------------------------------------------------------------------------
// Privacy policy generation.
// Returns a plain-text draft policy that the developer can host themselves.
// This is a STARTER document — not legal advice; the dialog UI surfaces that.
// ---------------------------------------------------------------------------
async function aiGeneratePrivacyPolicy({ appName, shortDesc, fullDesc, category, packageType }) {
  const system = `You draft starter privacy policies for Windows app developers publishing to the Microsoft Store. Output a clean, plain-text policy in clear language with section headings (no Markdown formatting marks, just plain text headings followed by paragraphs). Cover: what data the app collects (be conservative — only what's clearly implied by the description), how it's used, third parties, data retention, user rights, contact. End with a placeholder for contact email and last-updated date. Keep it under 600 words. This is a starter draft, not legal advice — include a one-line note to that effect at the very top.`;
  const user = [
    `App name: ${appName || '(unnamed app)'}`,
    `Package type: ${packageType || 'MSIX'}`,
    `Category: ${category || '(unknown)'}`,
    `Short description: ${shortDesc || '(none)'}`,
    `Full description: ${fullDesc || '(none)'}`,
    '',
    'Draft a starter privacy policy for this app. Be conservative about data collection claims — only mention what the description clearly implies.',
  ].join('\n');
  // Plain text, ~600 words. Reasoning helps the model think about which data
  // categories actually apply. Medium effort, generous token budget for the
  // reasoning model.
  const text = await callResponses({ system, user, maxOutputTokens: 6000, reasoningEffort: 'medium' });
  return text.trim();
}

// ---------------------------------------------------------------------------
// Image generation (FLUX.1.1-pro on Azure AI Foundry).
// Returns a data URL ready to drop into <img src="...">.
// ---------------------------------------------------------------------------
async function aiGenerateImage({ prompt, size = '1024x1024' }) {
  const direct = AI_CONFIG.imageEnabled;
  const body = JSON.stringify({
    model: AI_CONFIG.imageModel,   // '' in proxy mode; the server injects its own image model
    prompt,
    size,
    n: 1,
  });
  const res = await fetch(direct ? AI_CONFIG.imageEndpoint : aiProxyUrl('/api/ai/images'), {
    method: 'POST',
    headers: direct
      ? { 'api-key': AI_CONFIG.apiKey, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Image AI ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = await res.json();
  const img = json?.data?.[0];
  if (!img) throw new Error('Image AI returned no data');
  if (img.url) return img.url;
  if (img.b64_json) return `data:image/jpeg;base64,${img.b64_json}`;
  throw new Error('Image AI returned neither url nor b64_json');
}

// ---------------------------------------------------------------------------
// Generic per-field text transformation.
// Used by the in-form "✨ AI" buttons for Enhance / Shorter / Longer /
// Rewrite-as actions. Returns a plain string (no JSON schema) so the caller
// can drop it straight into the field. Low reasoning effort keeps it fast.
// ---------------------------------------------------------------------------
async function aiTransformText({ system, user, maxTokens = 800 }) {
  const text = await callResponses({
    system,
    user,
    maxOutputTokens: maxTokens,
    reasoningEffort: 'low',
  });
  return (text || '').trim();
}

// ---------------------------------------------------------------------------
// Conversational assistant for the Copilot chat panel.
// Answers ANY free-form question about publishing to the Microsoft Store, and —
// when the developer clearly wants an edit — classifies the request into one of
// the listing ACTIONS the panel can perform on the real form. Structured output:
//   { mode: 'answer'|'action', action: <enum|'none'>, reply: string }
// The caller runs the action (a deterministic, undoable form edit) and/or shows
// `reply`. Grounded with a compact snapshot of the current submission + recent
// turns so follow-ups make sense.
// ---------------------------------------------------------------------------
const CHAT_ACTIONS = [
  'setup_zip', 'draft_description', 'improve', 'shorten', 'lengthen',
  'tone_friendly', 'tone_professional', 'features', 'category',
  'whats_new', 'whats_missing', 'none',
];

async function aiListingChat({ message, history, context }) {
  const system = [
    'You are Copilot, built into the Microsoft Store app-publishing flow in the Windows Developer Center (the modern home for what developers used to call Partner Center).',
    'You help developers publish Windows apps: writing and improving the Store listing, and understanding submission, packaging (MSIX / MSI / EXE / PWA), age ratings (IARC), pricing, markets, certification, and Store policies.',
    'Answer ANY question the developer asks — clearly, accurately, and concisely (usually 2-5 sentences). If a question falls outside Microsoft Store publishing, still answer briefly and helpfully. Plain text only: no Markdown, no headings, no HTML tags.',
    '',
    "You can also trigger ACTIONS that edit the developer's live listing. Pick an action ONLY when the user clearly wants that change; otherwise set mode=\"answer\" and action=\"none\".",
    'Available actions:',
    '- setup_zip — open the "set up from a .zip" flow that auto-drafts everything from their project files.',
    '- draft_description — write a first app description.',
    '- improve — polish / clean up the existing description.',
    '- shorten — make the description shorter.',
    '- lengthen — expand the description with more detail.',
    '- tone_friendly — rewrite the description in a friendly, punchy tone.',
    '- tone_professional — rewrite the description in a professional tone.',
    '- features — draft feature-highlight bullets.',
    '- category — suggest / set the Store category.',
    '- whats_new — draft the "what\'s new in this version" notes.',
    '- whats_missing — list what still needs finishing before submitting.',
    '',
    'When mode="action": put a short, natural confirmation in reply (e.g. "Sure — polishing your description now.") and DO NOT write the listing content yourself; the app performs the edit. When mode="answer": put the full answer in reply.',
  ].join('\n');

  const ctx = context ? ('Current submission:\n' + context + '\n\n') : '';
  const hist = (history && history.length)
    ? ('Recent conversation:\n' + history.map(h => (h.role === 'me' ? 'Developer' : 'Copilot') + ': ' + h.text).join('\n') + '\n\n')
    : '';
  const user = ctx + hist + 'Developer says: ' + message;

  const schema = {
    name: 'copilot_chat',
    schema: {
      type: 'object',
      properties: {
        mode:   { type: 'string', enum: ['answer', 'action'] },
        action: { type: 'string', enum: CHAT_ACTIONS },
        reply:  { type: 'string' },
      },
      required: ['mode', 'action', 'reply'],
      additionalProperties: false,
    },
  };
  // Short answers + a tiny classification — low reasoning effort keeps the chat snappy;
  // generous token cap so the reasoning model always has room for the visible reply.
  const text = await callResponses({ system, user, schema, maxOutputTokens: 3000, reasoningEffort: 'low' });
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Expose on window so the prototype's existing scripts can call into it.
// ---------------------------------------------------------------------------
window.AI = {
  enabled:      AI_CONFIG.enabled,
  imageEnabled: AI_CONFIG.imageEnabled,
  generateListing:       aiGenerateListing,
  inferContentAnswers:   aiInferContentAnswers,
  translate:             aiTranslate,
  translateKeywords:     aiTranslateKeywords,
  generateImage:         aiGenerateImage,
  generatePrivacyPolicy: aiGeneratePrivacyPolicy,
  transformText:         aiTransformText,
  listingChat:           aiListingChat,
};

// When there's no embedded browser key, ask the server whether it can proxy AI
// (key held in a server env var / local ai-config.js). This is how AI works for
// everyone on a hosted deploy without shipping the key to git or the browser.
// Callers read window.AI.enabled on interaction, which is after this resolves.
(function probeServerAI() {
  if (AI_CONFIG.enabled && AI_CONFIG.imageEnabled) return; // already fully enabled by a local key
  try {
    fetch(aiProxyUrl('/api/ai/status'), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) return;
        var changed = false;
        if (!AI_CONFIG.enabled && s.enabled) { window.AI.enabled = true; changed = true; }
        if (!AI_CONFIG.imageEnabled && s.imageEnabled) { window.AI.imageEnabled = true; changed = true; }
        if (changed) {
          console.info('[ai-client] AI enabled via server proxy.');
          try { window.dispatchEvent(new CustomEvent('ai-ready', { detail: { enabled: window.AI.enabled, imageEnabled: window.AI.imageEnabled } })); } catch (e) {}
        }
      })
      .catch(function () {});
  } catch (e) {}
})();
