const API = Object.freeze({
  login: '/api/login/token',
  tasks: '/api/sunrun/tasks',
  preview: '/api/sunrun/preview',
  start: '/api/sunrun/start',
  jobs: '/api/sunrun/run-job',
});

function fail(code, details = {}) {
  throw Object.assign(new Error(code), {code, ...details});
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function publicProfile(profile) {
  if (!profile) return null;
  const allowed = ['stuNumber', 'stuName', 'schoolCode', 'schoolName', 'campusId', 'campusName'];
  return Object.fromEntries(allowed.filter(key => profile[key] !== undefined).map(key => [key, profile[key]]));
}

export class TotoroClient {
  constructor(config, {fetchImpl = fetch, timeoutMs = 30000} = {}) {
    this.baseUrl = config.baseUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.profile = null;
    this.tasks = [];
    this.selection = null;
    this.preview = null;
    this.lastRun = null;
    this.lastHealth = null;
  }

  state() {
    return {
      baseUrl: this.baseUrl,
      profile: publicProfile(this.profile),
      tasks: structuredClone(this.tasks),
      selection: this.selection ? {
        taskId: this.selection.task.taskId,
        routeId: this.selection.route?.pointId || '',
      } : null,
      preview: this.preview ? structuredClone(this.preview) : null,
      lastRun: this.lastRun ? structuredClone(this.lastRun) : null,
      lastHealth: this.lastHealth ? structuredClone(this.lastHealth) : null,
    };
  }

  async health() {
    const started = Date.now();
    try {
      const response = await this.fetchImpl(new URL('/', this.baseUrl), {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 3000)),
      });
      this.lastHealth = {
        reachable: response.status < 500,
        status: response.status,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      this.lastHealth = {
        reachable: false,
        status: null,
        latencyMs: Date.now() - started,
        code: error?.name === 'TimeoutError' ? 'TOTORO_TIMEOUT' : 'TOTORO_UNREACHABLE',
      };
    }
    return structuredClone(this.lastHealth);
  }

  async post(path, body) {
    if (!Object.values(API).includes(path)) fail('TOTORO_PATH_NOT_ALLOWED');
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl) fail('TOTORO_ORIGIN_ESCAPE');

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json;charset=UTF-8', 'Accept': 'application/json'},
        body: JSON.stringify(body ?? {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      fail(error?.name === 'TimeoutError' ? 'TOTORO_TIMEOUT' : 'TOTORO_UNREACHABLE', {path});
    }

    let result;
    try {
      result = await response.json();
    } catch {
      fail('TOTORO_INVALID_JSON', {path, status: response.status});
    }
    if (!response.ok || result?.success === false) {
      fail('TOTORO_API_ERROR', {
        path,
        status: response.status,
        upstreamMessage: typeof result?.message === 'string' ? result.message : null,
      });
    }
    return result;
  }

  async sync(token) {
    if (typeof token !== 'string' || token.length < 8) fail('TOTORO_AUTH_REQUIRED');

    const login = await this.post(API.login, {token});
    if (!plain(login.data)) fail('TOTORO_LOGIN_SHAPE_INVALID');
    this.profile = {...login.data};
    delete this.profile.token;

    const tasks = await this.post(API.tasks, {
      token,
      stu_number: this.profile.stuNumber,
      campus_id: this.profile.campusId,
    });
    if (!Array.isArray(tasks.tasks)) fail('TOTORO_TASKS_SHAPE_INVALID');
    this.tasks = tasks.tasks;
    this.selection = null;
    this.preview = null;
    this.lastRun = null;
    return this.state();
  }

  select(taskId, routeId = '') {
    const task = this.tasks.find(item => String(item?.taskId) === String(taskId));
    if (!task) fail('TOTORO_TASK_NOT_FOUND');

    const routes = Array.isArray(task.runPointList) ? task.runPointList : [];
    let route = null;
    if (routeId) {
      route = routes.find(item => String(item?.pointId) === String(routeId)) || null;
      if (!route) fail('TOTORO_ROUTE_NOT_FOUND');
    } else if (routes.length > 0) {
      fail('TOTORO_ROUTE_REQUIRED');
    }

    this.selection = {task, route};
    this.preview = null;
    return {
      task: structuredClone(task),
      route: route ? structuredClone(route) : null,
    };
  }

  async createPreview(token, {taskId, routeId = ''} = {}) {
    if (!this.profile) fail('TOTORO_NOT_SYNCED');
    if (typeof token !== 'string' || token.length < 8) fail('TOTORO_AUTH_REQUIRED');
    const selected = this.select(taskId, routeId);
    const result = await this.post(API.preview, {
      task: selected.task,
      route: selected.route,
      stu_number: this.profile.stuNumber,
      school_code: this.profile.schoolCode,
    });
    if (!plain(result.preview) || typeof result.preview.previewToken !== 'string') {
      fail('TOTORO_PREVIEW_SHAPE_INVALID');
    }
    this.preview = result.preview;
    return this.state();
  }

  async start(token) {
    if (!this.profile || !this.selection || !this.preview) fail('TOTORO_PREVIEW_REQUIRED');
    if (typeof token !== 'string' || token.length < 8) fail('TOTORO_AUTH_REQUIRED');

    const result = await this.post(API.start, {
      token,
      task: this.selection.task,
      route: this.selection.route,
      preview_token: this.preview.previewToken,
    });
    if (!plain(result.result)) fail('TOTORO_START_SHAPE_INVALID');
    this.lastRun = result.result;
    return this.state();
  }

  async jobs(token) {
    if (!this.profile) fail('TOTORO_NOT_SYNCED');
    if (typeof token !== 'string' || token.length < 8) fail('TOTORO_AUTH_REQUIRED');
    const result = await this.post(API.jobs, {token});
    if (!Array.isArray(result.jobs)) fail('TOTORO_JOBS_SHAPE_INVALID');
    return structuredClone(result.jobs);
  }

  async jobStatus(jobId) {
    if (!this.profile) fail('TOTORO_NOT_SYNCED');
    if (typeof jobId !== 'string' || !jobId.trim()) fail('TOTORO_JOB_ID_REQUIRED');
    const result = await this.post(API.jobs, {
      job_id: jobId.trim(),
      stu_number: this.profile.stuNumber,
      school_code: this.profile.schoolCode,
    });
    if (!plain(result.job)) fail('TOTORO_JOB_SHAPE_INVALID');
    return structuredClone(result.job);
  }
}

export {API as TOTORO_API_PATHS};
