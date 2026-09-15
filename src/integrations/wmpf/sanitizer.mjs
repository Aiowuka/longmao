const SECRET_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|openid|unionid)$/i;
const INLINE_SECRET = /\b(authorization|cookie|token|access_token|refresh_token|openid|unionid)(\s*[:=]\s*)([^\s,;&]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

function cleanString(value, state) {
  let next = value.replace(BEARER, match => {
    state.credentialPresent = true;
    return match.slice(0, 6) + ' ***';
  });
  next = next.replace(INLINE_SECRET, (_match, name, separator) => {
    state.credentialPresent = true;
    return `${name}${separator}***`;
  });
  return next;
}

/** Redact secrets in a copied value. Call this before every log, event or artifact write. */
export function sanitize(input) {
  const state = {credentialPresent: false};
  const seen = new WeakMap();
  function visit(value, key = '') {
    if (SECRET_KEY.test(key)) {
      state.credentialPresent = value != null && value !== '' || state.credentialPresent;
      return '***';
    }
    if (typeof value === 'string') {
      if (/^\s*[{[]/.test(value)) {
        try { return JSON.stringify(visit(JSON.parse(value))); } catch {}
      }
      return cleanString(value, state);
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const [childKey, child] of Object.entries(value)) copy[childKey] = visit(child, childKey);
    return copy;
  }
  return {value: visit(input), credentialPresent: state.credentialPresent};
}

export function safeJson(input) {
  return JSON.stringify(sanitize(input).value);
}
