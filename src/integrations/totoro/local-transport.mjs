const UPSTREAM_HOSTS = new Set(['wxxcx.xtotoro.com', 'app.xtotoro.com']);

export function assertLoopbackUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('EXTERNAL_BACKEND_BLOCKED');
  }
  return url;
}

/** A fetch implementation passed into unmodified Totoro modules. */
export function createLocalTransport(localBaseUrl, {fetchImpl = fetch} = {}) {
  const local = assertLoopbackUrl(localBaseUrl);
  return async function guardedFetch(input, init) {
    const requested = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!UPSTREAM_HOSTS.has(requested.hostname) && !['127.0.0.1', 'localhost', '[::1]'].includes(requested.hostname)) {
      throw new Error('EXTERNAL_BACKEND_BLOCKED');
    }
    const target = new URL(requested.pathname + requested.search, local);
    return fetchImpl(target, init);
  };
}
