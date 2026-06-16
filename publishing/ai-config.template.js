// ============================================================================
// ai-config.template.js — copy this to ai-config.js and fill in your own values.
//
// ai-config.js is gitignored because it holds a private Azure key. Never commit it.
// AI features are OPTIONAL — the publishing flow works fully without them
// (when no key is set, AI-assisted helpers are simply disabled).
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
