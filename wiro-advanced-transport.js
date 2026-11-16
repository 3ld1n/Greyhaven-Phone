/**
 * Greyhaven Phone v2.15.4 — narrow browser-to-server router for one Wiro model.
 * Installed before image-gen.js. Does not alter image metadata or reference order.
 * All older models continue using the original greyhaven-image relay.
 */
const MODEL = 'seedream-5-5-uncensored-advanced';
const ORIGINAL = '/api/plugins/greyhaven-image/';
const ADVANCED = '/api/plugins/greyhaven-image55/';
const MARK = Symbol.for('greyhaven.phone.wiro55.transport');
function activeModel() {
  try { return globalThis.SillyTavern?.getContext?.()?.extensionSettings?.greyhavenPhone?.imageGeneration?.model; }
  catch { return undefined; }
}
if (typeof globalThis.fetch === 'function' && !globalThis[MARK]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function greyhavenWiro55Fetch(input, options) {
    // Only handle our extension's exact plugin API URLs, never other fetches.
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url !== 'string' || !url.startsWith(ORIGINAL)) return originalFetch.call(this,input,options);
    const subpath = url.slice(ORIGINAL.length);
    const method = String(options?.method || 'GET').toUpperCase();
    if (subpath === 'generate' && method === 'POST' && typeof options?.body === 'string') {
      try {
        const payload = JSON.parse(options.body);
        if (payload.model === MODEL) {
          // New companion plugin validates the requested dimensions itself.
          // The old 2K resolution key is intentionally ignored for 5.5.
          delete payload.resolution;
          return originalFetch.call(this, ADVANCED+'generate', {...options,body:JSON.stringify(payload)});
        }
      } catch (e) { console.warn('[Greyhaven] Failed to route Seedream 5.5 request', e); }
    }
    if (subpath === 'health' && method === 'GET' && activeModel() === MODEL) {
      return originalFetch.call(this,ADVANCED+'health',options);
    }
    if (subpath === 'config' && method === 'POST' && typeof options?.body === 'string') {
      try {
        const payload = JSON.parse(options.body);
        if (payload.model === MODEL) {
          // The old relay rejects the new model when saving credentials.
          // Keep its configured model on 4.5; the extension's selected model
          // remains 5.5 locally, and the companion uses the same credentials.
          payload.model = 'seedream-v4-5-uncensored';
          return originalFetch.call(this,input,{...options,body:JSON.stringify(payload)});
        }
      } catch(e) {console.warn('[Greyhaven] Config compatibility failed',e);}
    }
    return originalFetch.call(this,input,options);
  };
  globalThis[MARK] = true;
}
