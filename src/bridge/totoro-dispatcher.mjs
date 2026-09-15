export class TotoroDispatcher {
  #adapter;
  #run;

  constructor(adapter, {mode = 'native'} = {}) {
    this.#adapter = adapter;
    this.#run = mode === 'modules' ? () => adapter.runModuleWorkflow() : () => adapter.runNativeWorkflow();
  }

  dispatch(event) {
    if (!/^(Runtime\.|Page\.)/.test(event.type)) return null;
    if (!this.promise) this.promise = this.#run();
    return this.promise;
  }
}
