const localBase = new URL(process.env.LONGMAO_LOCAL_BACKEND_URL || 'http://127.0.0.1:3210');
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const totoroUpstreams = new Set(['wxxcx.xtotoro.com', 'app.xtotoro.com']);

if (!loopback.has(localBase.hostname) || !['http:', 'https:'].includes(localBase.protocol)) {
  throw new Error('EXTERNAL_BACKEND_BLOCKED');
}

const originalFetch = globalThis.fetch;

async function sanitizedRequest(input, init, target) {
  const merged = new Request(input, init);
  const redirected = new Request(target, merged);
  const headers = new Headers(redirected.headers);
  if (headers.has('authorization')) headers.set('authorization', 'Bearer DEMO_SESSION');
  let body;
  const contentType = headers.get('content-type') || '';
  if (redirected.body && contentType.toLowerCase().includes('application/json')) {
    const text = await redirected.clone().text();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'token' in parsed) parsed.token = 'DEMO_SESSION';
      body = JSON.stringify(parsed);
    } catch { body = text; }
  }
  return new Request(redirected, {headers, ...(body === undefined ? {} : {body})});
}
if (!originalFetch.__longmaoGuarded) {
  const guarded = async (input, init) => {
    const source = new URL(input instanceof Request ? input.url : input);
    if (totoroUpstreams.has(source.hostname)) {
      const target = new URL(source.pathname + source.search, localBase);
      return originalFetch(await sanitizedRequest(input, init, target));
    }
    if (loopback.has(source.hostname)) return originalFetch(input, init);
    throw new Error('EXTERNAL_BACKEND_BLOCKED');
  };
  Object.defineProperty(guarded, '__longmaoGuarded', {value: true});
  globalThis.fetch = guarded;
}
