import {EventEmitter} from 'node:events';
import {sanitize} from './sanitizer.mjs';

const OBSERVED = /^(Runtime\.(consoleAPICalled|exceptionThrown|executionContextCreated)|Network\.(requestWillBeSent|responseReceived)|Page\.)/;

export class WmpfObserver extends EventEmitter {
  #client;
  credentialPresent = false;

  constructor(client) {
    super();
    this.#client = client;
  }

  start() {
    this.#client.on('event', event => {
      if (!OBSERVED.test(event.method)) return;
      const clean = sanitize(event);
      this.credentialPresent ||= clean.credentialPresent;
      this.emit('event', {...clean.value, credentialPresent: clean.credentialPresent});
    });
    this.#client.on('disconnect', () => this.emit('disconnect'));
  }
}
