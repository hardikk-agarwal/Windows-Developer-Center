// ============================================================================
// ai-config.template.js — copy this to ai-config.js and fill in your own values.
//
// ai-config.js is gitignored because it holds a private Azure key. Never commit it.
// AI features are OPTIONAL — the publishing flow works fully without them
// (when nothing is configured, AI-assisted helpers fall back to keyword heuristics).
//
// TWO WAYS TO ENABLE AI:
//   1) Local browser key (this file). Good for local dev on your own machine.
//      The key lives in the browser — fine locally, NOT for a shared deploy.
//   2) Server proxy (recommended for shared/hosted). Leave this file unset and
//      give server.js the key via environment variables — it never reaches git
//      or the browser, and AI then works for ALL users of that deployment:
//         AZURE_AI_ENDPOINT, AZURE_AI_KEY, AZURE_AI_MODEL
//         AZURE_AI_IMAGE_ENDPOINT, AZURE_AI_IMAGE_MODEL   (optional, images)
//      ai-client.js auto-detects the proxy via GET /api/ai/status.
// ============================================================================

window.AI_CONFIG = {
  endpoint: '',   // e.g. https://<resource>.services.ai.azure.com/api/projects/<project>/openai/v1/responses
  apiKey:   '',   // your Azure AI Foundry key — keep secret, never commit
  model:    'gpt-5-mini',
  enabled:  false, // set true once endpoint + apiKey are filled in

  // Image generation (optional). Used for "Generate placeholder screenshots".
  imageEndpoint: '', // e.g. https://<resource>.services.ai.azure.com/openai/v1/images/generations
  imageModel:    'FLUX-1.1-pro',
};
