const localBase = new URL(process.env.LONGMAO_LOCAL_BACKEND_URL || 'http://127.0.0.1:3210');
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const totoroUpstreams = new Set(['wxxcx.xtotoro.com', 'app.xtotoro.com']);

if (!loopback.has(localBase.hostname) || !['http:', 'https:'].includes(localBase.protocol)) {
  throw new Error('EXTERNAL_BACKEND_BLOCKED');
}

const originalFetch = globalThis.fetch;
if (!originalFetch.__longmaoGuarded) {
  const guarded = async (input, init) => {
    const source = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (totoroUpstreams.has(source.hostname)) {
      const target = new URL(source.pathname + source.search, localBase);
      return originalFetch(target, init);
    }
    if (loopback.has(source.hostname)) return originalFetch(input, init);
    throw new Error('EXTERNAL_BACKEND_BLOCKED');
  };
  Object.defineProperty(guarded, '__longmaoGuarded', {value: true});
  globalThis.fetch = guarded;
}
