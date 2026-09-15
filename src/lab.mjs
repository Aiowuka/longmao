/** Independently written, offline-only demonstration. See THIRD_PARTY_NOTICES.md. */
export const SCENARIOS = Object.freeze(['success', 'expired-session', 'rejected-submission']);

export class LabError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LabError';
    this.code = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new LabError(code);
}

function allowedOptions(options, names) {
  requireCondition(options !== null && typeof options === 'object' && !Array.isArray(options), 'INVALID_OPTIONS');
  requireCondition(Object.getPrototypeOf(options) === Object.prototype, 'INVALID_OPTIONS');
  requireCondition(Reflect.ownKeys(options).every(key => names.includes(key)), 'UNSUPPORTED_OPTION');
}

// These deliberately non-geographic fixture values are NOT a platform request format.
const TASK = Object.freeze({id: 'demo-task', label: 'Offline fixture exercise', fixtureId: 'toy-sequence-v1'});
const SAMPLE = Object.freeze({demoOnly: true, fixtureId: 'toy-sequence-v1', sampleCount: 4});
export function demoPayload() { return {...SAMPLE}; }

/** An in-memory mock, not a Totoro client. No URL, token, HTTP or CDP adapter. */
export class MockBackend {
  #scenario;
  #session = null;
  #jobs = new Map();
  #receipts = new Map();
  #closed = false;

  constructor(options = {}) {
    allowedOptions(options, ['scenario']);
    this.#scenario = options.scenario ?? 'success';
    requireCondition(SCENARIOS.includes(this.#scenario), 'INVALID_SCENARIO');
  }

  #authenticate(session) {
    requireCondition(!this.#closed, 'BACKEND_CLOSED');
    requireCondition(this.#session !== null && session === this.#session, 'INVALID_SESSION');
    requireCondition(this.#scenario !== 'expired-session', 'SESSION_EXPIRED');
  }

  login() {
    requireCondition(!this.#closed, 'BACKEND_CLOSED');
    // Object identity is sufficient for this isolated mock. No real credential exists.
    if (!this.#session) this.#session = Object.freeze({kind: 'mock-session'});
    return this.#session;
  }

  listTasks(session) {
    this.#authenticate(session);
    return [{...TASK}];
  }

  openJob(session, taskId) {
    this.#authenticate(session);
    requireCondition(taskId === TASK.id, 'UNKNOWN_TASK');
    const job = {id: `mock-job-${this.#jobs.size + 1}`, taskId, state: 'created'};
    this.#jobs.set(job.id, job);
    return {...job};
  }

  submit(session, jobId, payload, idempotencyKey) {
    this.#authenticate(session);
    const job = this.#jobs.get(jobId);
    requireCondition(Boolean(job), 'UNKNOWN_JOB');
    allowedOptions(payload, ['demoOnly', 'fixtureId', 'sampleCount']);
    requireCondition(payload.demoOnly === true && payload.fixtureId === SAMPLE.fixtureId && payload.sampleCount === SAMPLE.sampleCount, 'INVALID_DEMO_PAYLOAD');
    requireCondition(typeof idempotencyKey === 'string' && /^demo-[a-z0-9-]{1,48}$/.test(idempotencyKey), 'INVALID_IDEMPOTENCY_KEY');
    const existing = this.#receipts.get(idempotencyKey);
    if (existing) {
      requireCondition(existing.jobId === jobId, 'IDEMPOTENCY_CONFLICT');
      return {...existing};
    }
    requireCondition(job.state === 'created', 'JOB_ALREADY_SUBMITTED');
    requireCondition(this.#scenario !== 'rejected-submission', 'MOCK_REJECTED_SUBMISSION');
    const receipt = Object.freeze({
      id: `mock-receipt-${this.#receipts.size + 1}`, jobId,
      demoOnly: true, status: 'accepted-in-mock', sampleCount: payload.sampleCount,
    });
    this.#receipts.set(idempotencyKey, receipt);
    job.state = 'submitted';
    return {...receipt};
  }

  readReceipt(session, idempotencyKey) {
    this.#authenticate(session);
    const receipt = this.#receipts.get(idempotencyKey);
    requireCondition(Boolean(receipt), 'RECEIPT_NOT_FOUND');
    return {...receipt};
  }

  close() {
    this.#session = null;
    this.#jobs.clear();
    this.#receipts.clear();
    this.#closed = true;
  }
}

/** A fixed pipeline with two reproducible failure scenarios; errors stop subsequent steps. */
export function runDemo(options = {}) {
  allowedOptions(options, ['scenario']);
  const scenario = options.scenario ?? 'success';
  requireCondition(SCENARIOS.includes(scenario), 'INVALID_SCENARIO');
  const backend = new MockBackend({scenario});
  const report = {schemaVersion: 1, mode: 'offline-mock', scenario, ok: false, steps: [], receipt: null, error: null};
  function step(name, operation) {
    try {
      const value = operation();
      report.steps.push({name, status: 'passed'});
      return value;
    } catch (error) {
      report.steps.push({name, status: 'failed'});
      throw error;
    }
  }
  try {
    const session = step('mock-login', () => backend.login());
    const task = step('load-fixture-task', () => backend.listTasks(session)[0]);
    const job = step('create-mock-job', () => backend.openJob(session, task.id));
    const payload = step('prepare-fixed-fixture', () => demoPayload());
    const receipt = step('submit-to-in-memory-mock', () => backend.submit(session, job.id, payload, 'demo-submission'));
    step('verify-mock-receipt', () => {
      const saved = backend.readReceipt(session, 'demo-submission');
      requireCondition(saved.id === receipt.id && saved.demoOnly === true && saved.status === 'accepted-in-mock', 'MOCK_VERIFICATION_FAILED');
    });
    report.receipt = receipt;
    report.ok = true;
  } catch (error) {
    // Never serialize arbitrary exception text or data into reports.
    report.error = {code: error instanceof LabError ? error.code : 'INTERNAL_ERROR'};
  } finally {
    backend.close();
  }
  return report;
}
