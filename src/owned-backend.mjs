import {generateSyntheticRun, validateRunPlan} from './run-generator.mjs';

function fail(code, details = {}) {
  throw Object.assign(new Error(code), {code, ...details});
}

function getPath(value, path) {
  let current = value;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

function renderPath(path, params = {}) {
  return path.replace(/\{(runId|receiptId)\}/g, (_, name) => {
    const value = params[name];
    if (typeof value !== 'string' || !value) fail('MISSING_BACKEND_PATH_PARAM', {param: name});
    return encodeURIComponent(value);
  });
}

export class SelfHostedBackend {
  constructor(config, {fetchImpl = fetch, timeoutMs = 10000} = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.latestReport = null;
  }

  status() {
    return {
      configured: true,
      origin: this.config.origin,
      latestRun: this.latestReport ? {
        ok: this.latestReport.ok,
        runId: this.latestReport.run?.runId || null,
        receiptId: this.latestReport.run?.receiptId || null,
        finishedAt: this.latestReport.finishedAt,
      } : null,
    };
  }

  async request(name, {token, body, pathParams} = {}) {
    const endpoint = this.config.endpoints[name];
    if (!endpoint) fail('BACKEND_ENDPOINT_NOT_CONFIGURED', {endpoint: name});
    if (typeof token !== 'string' || token.length < 8) fail('BACKEND_AUTH_REQUIRED');

    const path = renderPath(endpoint.path, pathParams);
    const url = new URL(path, this.config.origin);
    if (url.origin !== this.config.origin) fail('BACKEND_ORIGIN_ESCAPE');

    const headers = {'Accept': 'application/json'};
    headers[this.config.auth.outbound.header] = this.config.auth.outbound.prefix + token;
    const init = {
      method: endpoint.method,
      headers,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (endpoint.method !== 'GET') {
      headers['Content-Type'] = 'application/json;charset=UTF-8';
      init.body = JSON.stringify(body ?? null);
    }

    const started = Date.now();
    let response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (cause) {
      fail(cause?.name === 'TimeoutError' ? 'BACKEND_TIMEOUT' : 'BACKEND_CONNECTION_FAILED', {
        endpoint: name,
        elapsedMs: Date.now() - started,
      });
    }

    const elapsedMs = Date.now() - started;
    if (!response.ok) fail('BACKEND_HTTP_ERROR', {endpoint: name, status: response.status, elapsedMs});

    let result;
    try {
      result = await response.json();
    } catch {
      fail('BACKEND_INVALID_JSON', {endpoint: name, status: response.status, elapsedMs});
    }
    return {result, step: {endpoint: name, method: endpoint.method, path, status: response.status, elapsedMs}};
  }

  async getProfile(token) {
    if (!this.config.endpoints.profile) return null;
    return (await this.request('profile', {token})).result;
  }

  async getTasks(token) {
    if (!this.config.endpoints.tasks) return null;
    return (await this.request('tasks', {token})).result;
  }

  async run(input, token, {startedAt = new Date()} = {}) {
    const plan = validateRunPlan(input);
    const steps = [];
    const report = {
      ok: false,
      mode: 'self-hosted-backend',
      backendOrigin: this.config.origin,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      steps,
      run: null,
      profile: null,
      tasks: null,
      receipt: null,
      error: null,
    };

    const step = async (name, operation) => {
      try {
        const output = await operation();
        if (output?.step) steps.push({...output.step, stage: name, ok: true});
        else steps.push({stage: name, ok: true});
        return output;
      } catch (error) {
        steps.push({
          stage: name,
          ok: false,
          code: error?.code || 'BACKEND_FLOW_FAILED',
          endpoint: error?.endpoint || null,
          status: error?.status || null,
        });
        throw error;
      }
    };

    try {
      if (this.config.endpoints.profile) {
        const output = await step('profile', () => this.request('profile', {token}));
        report.profile = output.result;
      }
      if (this.config.endpoints.tasks) {
        const output = await step('tasks', () => this.request('tasks', {token}));
        report.tasks = output.result;
      }

      const track = generateSyntheticRun(plan, {startedAt});
      steps.push({stage: 'generate_synthetic_run', ok: true, pointCount: track.points.length});

      const startOutput = await step('start', () => this.request('start', {
        token,
        body: {
          taskId: plan.taskId,
          synthetic: true,
          client: {name: 'longmao', contractVersion: 1},
          plan: {
            distanceMeters: plan.distanceMeters,
            durationSeconds: plan.durationSeconds,
            startedAt: track.startedAt,
          },
        },
      }));
      const runIdValue = getPath(startOutput.result, this.config.ids.runIdPath);
      const runId = runIdValue == null ? '' : String(runIdValue);
      if (!runId) fail('BACKEND_RUN_ID_MISSING');

      const submitOutput = await step('submit', () => this.request('submit', {
        token,
        body: {
          runId,
          taskId: plan.taskId,
          track,
        },
      }));
      const receiptValue = getPath(submitOutput.result, this.config.ids.receiptIdPath);
      const receiptId = receiptValue == null || receiptValue === '' ? runId : String(receiptValue);

      let receipt = submitOutput.result;
      if (this.config.endpoints.receipt) {
        const receiptOutput = await step('receipt', () => this.request('receipt', {
          token,
          pathParams: {receiptId, runId},
        }));
        receipt = receiptOutput.result;
      }

      report.run = {runId, receiptId, summary: track.summary};
      report.receipt = receipt;
      report.ok = true;
    } catch (error) {
      report.error = {
        code: error?.code || 'BACKEND_FLOW_FAILED',
        endpoint: error?.endpoint || null,
        status: error?.status || null,
      };
    }

    report.finishedAt = new Date().toISOString();
    this.latestReport = report;
    return structuredClone(report);
  }
}
