import {EventEmitter} from 'node:events';
import {normalizeCdpEvent} from './event-normalizer.mjs';
import {SessionContext} from './session-context.mjs';
import {TotoroDispatcher} from './totoro-dispatcher.mjs';

export class BridgeController extends EventEmitter {
  context = new SessionContext();

  constructor({observer, adapter, mode = 'native'} = {}) {
    super();
    this.observer = observer;
    this.dispatcher = new TotoroDispatcher(adapter, {mode});
  }

  start() {
    this.observer.on('event', event => this.#onEvent(event));
    this.observer.on('disconnect', () => { this.context.state = 'disconnected'; this.emit('status', this.context.snapshot()); });
    this.observer.start();
  }

  async #onEvent(raw) {
    const event = normalizeCdpEvent(raw);
    if (!event || !this.context.accept(event)) return;
    this.emit('status', this.context.snapshot());
    const dispatched = this.dispatcher.dispatch(event);
    if (!dispatched) return;
    try {
      const result = await dispatched;
      this.context.state = 'completed';
      this.emit('completed', {result, session: this.context.snapshot()});
    } catch {
      this.context.state = 'failed';
      this.emit('failed', {code: 'TOTORO_WORKFLOW_FAILED', session: this.context.snapshot()});
    }
  }
}
