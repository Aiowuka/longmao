import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';

const HOP_HEADERS = new Set(['connection', 'content-length', 'content-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const MAX_REQUEST_BYTES = 1024 * 1024;

function bootstrapScript(key) {
  return `<script data-longmao-bridge>(()=>{
  if(window.__longmaoBridgeStarted)return;
  window.__longmaoBridgeStarted=true;
  const clientId=crypto.randomUUID();
  const credentialEndpoint='/__longmao/credential?key=${key}';
  const readyEndpoint='/__longmao/dashboard-ready?key=${key}';
  const status=value=>document.documentElement.dataset.longmaoBridge=value;
  status('starting');
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const signalReady=()=>fetch(readyEndpoint,{method:'POST',cache:'no-store',credentials:'same-origin'});
  async function receiveCredential(){
    status('waiting');
    for(;;){
      let response;
      try{
        response=await fetch(credentialEndpoint+'&client='+encodeURIComponent(clientId),{method:'POST',cache:'no-store',credentials:'same-origin'});
      }catch{status('retrying');await wait(500);continue;}
      status('credential-'+response.status);
      if(response.ok){
        let data;
        try{data=await response.json();}catch{throw new Error('CredentialResponseInvalid');}
        if(Array.isArray(data)&&data[0])return data[0];
      }
      await wait(500);
    }
  }
  async function connect(){
    if(location.pathname==='/dashboard'){status('dashboard');await signalReady();return;}
    while(document.visibilityState!=='visible'||document.readyState!=='complete')await wait(100);
    await wait(750);
    for(;;){
      const token=await receiveCredential();
      status('filling');
      let input;
      while(!(input=document.querySelector('#login-token')))await wait(100);
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if(!setter)throw new Error('InputSetterUnavailable');
      setter.call(input,token);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      await wait(50);
      if(!input.form)throw new Error('LoginFormUnavailable');
      input.form.requestSubmit();
      status('submitted');
      for(let attempt=0;attempt<150;attempt++){
        if(location.pathname==='/dashboard'){status('dashboard');await signalReady();return;}
        await wait(100);
      }
      status('waiting-for-new-credential');
    }
  }
  connect().catch(error=>status('error-'+(error?.name||'Error')));
})();</script>`;
}

function cookieValue(request, name) {
  for (const part of (request.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function requestBody(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    request.resume();
    return null;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      request.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export class TotoroUiProxy extends EventEmitter {
  #upstream;
  #host;
  #port;
  #server;
  #credential = null;
  #credentialTimer;
  #credentialClients = new Map();
  #credentialWasConsumed = false;
  #dashboardReady = false;
  #key = randomBytes(24).toString('base64url');
  #launchKey = randomBytes(24).toString('base64url');
  #launchAvailable = true;
  #session = randomBytes(24).toString('base64url');

  constructor({upstreamUrl, host = '127.0.0.1', port = 3211} = {}) {
    super();
    this.#upstream = new URL(upstreamUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(this.#upstream.hostname)) throw new Error('TOTORO_UI_UPSTREAM_MUST_BE_LOOPBACK');
    if (!['127.0.0.1', '::1'].includes(host)) throw new Error('TOTORO_UI_PROXY_MUST_BE_LOOPBACK');
    this.#host = host;
    this.#port = port;
  }

  get origin() {
    if (!this.#server?.listening) throw new Error('TOTORO_UI_PROXY_NOT_RUNNING');
    return `http://${this.#host === '::1' ? '[::1]' : this.#host}:${this.#server.address().port}`;
  }

  get url() {
    return `${this.origin}/__longmao/launch?key=${this.#launchKey}`;
  }

  offerCredential(token) {
    if (typeof token !== 'string' || !token || token.length > 16384 || /\s/.test(token)) throw new Error('INVALID_EPHEMERAL_CREDENTIAL');
    this.#credential = token;
    this.#credentialClients.clear();
    this.#credentialWasConsumed = false;
    this.#dashboardReady = false;
    clearTimeout(this.#credentialTimer);
    this.#credentialTimer = setTimeout(() => { this.#credential = null; }, 60000);
    this.#credentialTimer.unref();
    this.emit('credentialOffered');
  }

  #requestIsLocal(request) {
    if (request.headers.host !== new URL(this.origin).host) return false;
    if (request.headers.origin && request.headers.origin !== this.origin) return false;
    const fetchSite = request.headers['sec-fetch-site'];
    return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
  }

  #authorized(request) {
    return cookieValue(request, 'longmao_session') === this.#session;
  }

  #json(response, statusCode, value) {
    response.statusCode = statusCode;
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store, max-age=0');
    response.setHeader('pragma', 'no-cache');
    response.setHeader('referrer-policy', 'no-referrer');
    response.end(JSON.stringify(value));
  }

  async #handle(request, response) {
    if (!this.#requestIsLocal(request)) {
      this.#json(response, 404, {ok: false});
      return;
    }
    const incoming = new URL(request.url, this.origin);
    if (incoming.pathname === '/__longmao/launch') {
      if (request.method !== 'GET' || !this.#launchAvailable || incoming.searchParams.get('key') !== this.#launchKey) {
        this.#json(response, 404, {ok: false});
        return;
      }
      this.#launchAvailable = false;
      response.statusCode = 302;
      response.setHeader('location', '/');
      response.setHeader('set-cookie', `longmao_session=${this.#session}; HttpOnly; SameSite=Strict; Path=/`);
      response.setHeader('cache-control', 'no-store, max-age=0');
      response.setHeader('referrer-policy', 'no-referrer');
      response.end();
      return;
    }
    if (!this.#authorized(request)) {
      this.#json(response, 404, {ok: false});
      return;
    }
    if (incoming.pathname === '/__longmao/credential') {
      const client = incoming.searchParams.get('client');
      if (request.method !== 'POST' || incoming.searchParams.get('key') !== this.#key || !/^[0-9a-f-]{36}$/i.test(client || '')) {
        this.#json(response, 404, [null]);
        return;
      }
      const firstSeen = this.#credentialClients.get(client);
      if (!firstSeen) {
        if (this.#credentialClients.size >= 8) this.#credentialClients.delete(this.#credentialClients.keys().next().value);
        this.#credentialClients.set(client, Date.now());
        this.#json(response, 200, [null]);
        return;
      }
      if (Date.now() - firstSeen < 250) {
        this.#json(response, 200, [null]);
        return;
      }
      const token = this.#credential;
      if (token) {
        this.#credential = null;
        clearTimeout(this.#credentialTimer);
      }
      const firstDelivery = !this.#credentialWasConsumed && Boolean(token);
      this.#credentialWasConsumed ||= Boolean(token);
      this.#json(response, 200, [token]);
      if (firstDelivery) this.emit('credentialConsumed');
      return;
    }
    if (incoming.pathname === '/__longmao/dashboard-ready') {
      if (request.method !== 'POST' || incoming.searchParams.get('key') !== this.#key || !this.#credentialWasConsumed) {
        this.#json(response, 404, {ok: false});
        return;
      }
      this.#credential = null;
      clearTimeout(this.#credentialTimer);
      this.#json(response, 200, {ok: true});
      if (!this.#dashboardReady) {
        this.#dashboardReady = true;
        this.emit('dashboardReady');
      }
      return;
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await requestBody(request);
    if (body === null) {
      this.#json(response, 413, {ok: false, code: 'REQUEST_TOO_LARGE'});
      return;
    }
    const target = new URL(incoming.pathname + incoming.search, this.#upstream);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (!HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== 'host' && name.toLowerCase() !== 'cookie' && value != null) {
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
    }
    const upstreamCookies = (request.headers.cookie || '').split(';')
      .map(cookie => cookie.trim()).filter(cookie => cookie && !/^longmao_session=/i.test(cookie));
    if (upstreamCookies.length) headers.set('cookie', upstreamCookies.join('; '));
    const upstream = await fetch(target, {method: request.method, headers, body, redirect: 'manual'});
    let upstreamBody = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = upstreamBody.toString().replace('</head>', `${bootstrapScript(this.#key)}</head>`);
      upstreamBody = Buffer.from(html);
    }
    response.statusCode = upstream.status;
    for (const [name, value] of upstream.headers) if (!HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== 'set-cookie') response.setHeader(name, value);
    const setCookies = upstream.headers.getSetCookie?.() || [];
    const safeSetCookies = setCookies.filter(cookie => !/^longmao_session=/i.test(cookie));
    if (safeSetCookies.length) response.setHeader('set-cookie', safeSetCookies);
    response.setHeader('cache-control', contentType.includes('text/html') ? 'no-store' : upstream.headers.get('cache-control') || 'no-cache');
    response.end(upstreamBody);
  }

  async start() {
    this.#server = createServer((request, response) => this.#handle(request, response).catch(() => {
      if (!response.headersSent) response.statusCode = 502;
      response.end('Totoro UI proxy error');
    }));
    await new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.#port, this.#host, resolve);
    });
    return this;
  }

  async close() {
    this.#credential = null;
    this.#credentialClients.clear();
    clearTimeout(this.#credentialTimer);
    if (!this.#server) return;
    await new Promise((resolve, reject) => this.#server.close(error => error ? reject(error) : resolve()));
  }
}
