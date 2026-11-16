/*
 * Minimal compatibility adapter for the existing Greyhaven image relay.
 * Seedream 5.5 Uncensored Advanced expects width and height, not the legacy
 * resolution/aspectRatio fields used by the earlier Seedream models.
 *
 * This patch only touches requests to Greyhaven's image-generation route,
 * and only for the exact new model. Other fetches remain unchanged.
 *
 * The separately installed SillyTavern server-side relay must still allow
 * the new model and forward width/height to Wiro's Run API endpoint.
 */
const MODEL = 'seedream-5-5-uncensored-advanced';
const MARK = Symbol.for('greyhaven.phone.wiro55.transport');

function advancedDimensions(aspect) {
  switch (aspect) {
    case '9:16': return { width:1152, height:2048 };
    case '4:5': return { width:1280, height:1600 };
    case '4:3': return { width:1536, height:1152 };
    default: return { width:1152, height:1536 }; // 3:4
  }
}

if (typeof globalThis.fetch === 'function' && !globalThis[MARK]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function greyhavenWiro55Fetch(input, options) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(options?.method || 'GET').toUpperCase();
    if (typeof url === 'string' &&
        url.endsWith('/api/plugins/greyhaven-image/generate') &&
        method === 'POST' && typeof options?.body === 'string') {
      try {
        const payload = JSON.parse(options.body);
        if (payload && payload.model === MODEL) {
          const {width, height} = advancedDimensions(payload.aspectRatio);
          // Preserve the actual image metadata prompt and reference payload.
          // Only the model-specific sizing parameters are adapted.
          payload.width = width;
          payload.height = height;
          delete payload.resolution;
          delete payload.aspectRatio;
          options = { ...options, body:JSON.stringify(payload) };
        }
      } catch (error) {
        console.warn('[Greyhaven Phone] Could not adapt Seedream 5.5 sizing:', error);
      }
    }
    return originalFetch.call(this, input, options);
  };
  globalThis[MARK] = true;
}
