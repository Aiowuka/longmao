export class SessionContext {
  #ids = new Set();
  state = 'waiting';
  eventCount = 0;
  duplicateCount = 0;
  credentialPresent = false;
  lastEventType = null;

  accept(event) {
    if (this.#ids.has(event.eventId)) { this.duplicateCount++; return false; }
    this.#ids.add(event.eventId);
    this.eventCount++;
    this.credentialPresent ||= event.credentialPresent;
    this.lastEventType = event.type;
    this.state = 'runtime-attached';
    return true;
  }

  snapshot() {
    return {state: this.state, eventCount: this.eventCount, duplicateCount: this.duplicateCount, credentialPresent: this.credentialPresent, lastEventType: this.lastEventType};
  }
}
