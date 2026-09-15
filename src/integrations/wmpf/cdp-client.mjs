import {EventEmitter} from 'node:events';
import WebSocket from 'ws';

const DOMAINS = ['Network.enable', 'Runtime.enable', 'Page.enable'];

export class CdpClient extends EventEmitter {
  #endpoint;
  #WebSocket;
  #socket;
  #nextId = 0;
  #pending = new Map();
  #connectTimeoutMs;
  #autoReconnect;
  #reconnectDelayMs;
  #closed = false;
  #commandTimeoutMs;
  #attaching = false;
  #reconnectTimer;

  constructor({endpoint = 'ws://127.0.0.1:62000', WebSocketImpl = WebSocket, connectTimeoutMs = 5000, commandTimeoutMs = 1000, autoReconnect = true, reconnectDelayMs = 500} = {}) {
    super();
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
      throw new Error('WMPF_ENDPOINT_MUST_BE_LOOPBACK_WS');
    }
    this.#endpoint = parsed.href;
    this.#WebSocket = WebSocketImpl;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#autoReconnect = autoReconnect;
    this.#reconnectDelayMs = reconnectDelayMs;
    this.#commandTimeoutMs = commandTimeoutMs;
  }

  get endpoint() { return this.#endpoint; }
  get connected() { return this.#socket?.readyState === this.#WebSocket.OPEN; }

  async connect() {
    if (this.#closed) throw new Error('CDP_CLIENT_CLOSED');
    if (this.connected) return;
    const socket = new this.#WebSocket(this.#endpoint);
    this.#socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate?.();
        reject(new Error('CDP_CONNECT_TIMEOUT'));
      }, this.#connectTimeoutMs);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', error => { clearTimeout(timer); reject(new Error('CDP_CONNECTION_FAILED', {cause: error})); });
    });
    socket.on('message', bytes => this.#receive(bytes));
    socket.on('close', () => {
      for (const {reject} of this.#pending.values()) reject(new Error('CDP_DISCONNECTED'));
      this.#pending.clear();
      this.emit('disconnect');
      this.#scheduleReconnect();
    });
    socket.on('error', () => {});
    void this.#attachWhenMiniappIsReady();
  }

  #scheduleReconnect() {
    if (!this.#autoReconnect || this.#closed || this.#reconnectTimer) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (this.#closed) return;
      this.connect()
        .then(() => this.emit('reconnect'))
        .catch(() => this.#scheduleReconnect());
    }, this.#reconnectDelayMs);
    this.#reconnectTimer.unref();
  }

  async #attachWhenMiniappIsReady() {
    if (this.#attaching) return;
    this.#attaching = true;
    try {
      while (this.connected && !this.#closed) {
        try {
          for (const method of DOMAINS) await this.send(method);
          this.emit('ready');
          return;
        } catch {
          if (this.connected && !this.#closed) await new Promise(resolve => setTimeout(resolve, this.#reconnectDelayMs));
        }
      }
    } finally { this.#attaching = false; }
  }

  #receive(bytes) {
    let message;
    try { message = JSON.parse(bytes.toString()); }
    catch { this.emit('protocolError', {code: 'MALFORMED_CDP_MESSAGE'}); return; }
    if (Number.isInteger(message.id) && this.#pending.has(message.id)) {
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error('CDP_COMMAND_FAILED'));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (typeof message.method === 'string') this.emit('event', message);
  }

  send(method, params = {}) {
    if (!this.connected) return Promise.reject(new Error('CDP_NOT_CONNECTED'));
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('CDP_COMMAND_TIMEOUT'));
      }, this.#commandTimeoutMs);
      this.#pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.#socket.send(JSON.stringify({id, method, params}), error => {
        if (error) {
          this.#pending.delete(id);
          reject(new Error('CDP_SEND_FAILED', {cause: error}));
        }
      });
    });
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    if (this.#socket && this.#socket.readyState < this.#WebSocket.CLOSING) this.#socket.close();
  }
}
