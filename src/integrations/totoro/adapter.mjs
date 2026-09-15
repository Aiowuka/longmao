import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {inspectTotoro, loadTotoroModules} from './loader.mjs';
import {assertLoopbackUrl, createLocalTransport} from './local-transport.mjs';
import {childIsRunning, stopProcessTree} from '../../process-tree.mjs';

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const guardPath = resolve(import.meta.dirname, 'totoro-fetch-guard.mjs');
const guardUrl = pathToFileURL(guardPath).href;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withoutLongmaoGuard(nodeOptions = '') {
  let result = nodeOptions;
  for (const target of [guardUrl, guardPath]) {
    const escaped = escapeRegExp(target);
    result = result.replace(new RegExp(`(?:^|\\s)--import(?:=|\\s+)(?:["']${escaped}["']|${escaped})(?=\\s|$)`, 'g'), ' ');
  }
  return result.trim().replace(/\s+/g, ' ');
}

export function createTotoroEnvironment({transport, backendUrl, inherited = process.env} = {}) {
  const environment = {...inherited, NEXT_TELEMETRY_DISABLED: '1'};
  if (transport === 'local') {
    environment.LONGMAO_LOCAL_BACKEND_URL = backendUrl;
    environment.NODE_OPTIONS = `${inherited.NODE_OPTIONS || ''} --import=${guardUrl}`.trim();
  } else {
    delete environment.LONGMAO_LOCAL_BACKEND_URL;
    const nodeOptions = withoutLongmaoGuard(inherited.NODE_OPTIONS);
    if (nodeOptions) environment.NODE_OPTIONS = nodeOptions;
    else delete environment.NODE_OPTIONS;
  }
  return environment;
}

async function jsonPost(url, body, timeoutMs) {
  const response = await fetch(url, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error('TOTORO_NATIVE_API_FAILED');
  return result;
}

export class TotoroAdapter {
  #root;
  #backendUrl;
  #transport;
  #url;
  #process;
  #timeoutMs;

  constructor({root, backendUrl = 'http://127.0.0.1:3210', transport = 'local', host = '127.0.0.1', port = 3220, timeoutMs = 30000} = {}) {
    if (!root) throw new Error('TOTORO_ROOT_REQUIRED');
    this.#root = root instanceof URL ? fileURLToPath(root) : resolve(root);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_TOTORO_PORT');
    if (!['local', 'native'].includes(transport)) throw new Error('INVALID_TOTORO_TRANSPORT');
    this.#transport = transport;
    this.#backendUrl = transport === 'local' ? assertLoopbackUrl(backendUrl).href : null;
    this.#url = assertLoopbackUrl(`http://${host}:${port}`).href;
    this.#timeoutMs = timeoutMs;
  }

  get url() { return this.#url; }
  get running() { return childIsRunning(this.#process); }

  async inspect() { return inspectTotoro({root: this.#root}); }

  async start() {
    await this.inspect();
    await access(resolve(this.#root, 'node_modules/next/package.json'))
      .catch(() => { throw new Error('TOTORO_DEPENDENCIES_MISSING'); });
    const executable = resolve(this.#root, 'node_modules/next/dist/bin/next');
    const port = new URL(this.#url).port;
    const host = new URL(this.#url).hostname;
    const environment = createTotoroEnvironment({transport: this.#transport, backendUrl: this.#backendUrl});
    this.#process = spawn(process.execPath, [executable, 'dev', '--hostname', host, '--port', port], {
      cwd: this.#root,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    let exited = null;
    let spawnError = null;
    this.#process.stdout.on('data', () => {});
    this.#process.stderr.on('data', () => {});
    this.#process.once('error', error => { spawnError = error; });
    this.#process.once('exit', code => { exited = code; });
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) throw new Error('TOTORO_NATIVE_SERVER_SPAWN_FAILED', {cause: spawnError});
      if (exited !== null || this.#process.signalCode !== null) throw new Error('TOTORO_NATIVE_SERVER_EXITED');
      try {
        const response = await fetch(this.#url, {signal: AbortSignal.timeout(1000)});
        if (response.ok) return this;
      } catch {}
      await delay(200);
    }
    throw new Error('TOTORO_NATIVE_SERVER_TIMEOUT');
  }

  async runNativeWorkflow() {
    if (this.#transport !== 'local') throw new Error('LOCAL_TOTORO_TRANSPORT_REQUIRED');
    if (!this.running) throw new Error('TOTORO_NATIVE_SERVER_NOT_RUNNING');
    const login = await jsonPost(new URL('/api/login/token', this.#url), {token: 'DEMO_SESSION'}, this.#timeoutMs);
    const profile = login.data;
    const taskResult = await jsonPost(new URL('/api/sunrun/tasks', this.#url), {
      token: 'DEMO_SESSION', stu_number: profile.stuNumber, campus_id: profile.campusId,
    }, this.#timeoutMs);
    const task = taskResult.tasks?.[0];
    const route = task?.runPointList?.[0];
    if (!task || !route) throw new Error('TOTORO_NATIVE_TASK_MISSING');
    const run = await jsonPost(new URL('/api/sunrun/start', this.#url), {
      token: 'DEMO_SESSION', stu_number: profile.stuNumber, school_code: profile.schoolCode, task, route,
    }, this.#timeoutMs);
    return {mode: 'native-next-backend', taskId: task.taskId, routeId: route.pointId, scantronId: run.result.scantronId, steps: 10};
  }

  async runModuleWorkflow() {
    if (this.#transport !== 'local') throw new Error('LOCAL_TOTORO_TRANSPORT_REQUIRED');
    const modules = await loadTotoroModules({root: this.#root});
    const fetchImpl = createLocalTransport(this.#backendUrl);
    const profile = await modules.loginWithToken('DEMO_SESSION', {fetchImpl});
    const service = new modules.SunRunService({token: 'DEMO_SESSION', stuNumber: profile.stuNumber, campusId: profile.campusId}, {fetchImpl});
    const task = (await service.getSunrunTasks())[0];
    const route = task?.runPointList?.[0];
    if (!route) throw new Error('TOTORO_MODULE_TASK_MISSING');
    const result = await modules.startRun({token: 'DEMO_SESSION', stuNumber: profile.stuNumber, schoolCode: profile.schoolCode, task, route}, {
      fetchImpl, baseUrl: 'https://wxxcx.xtotoro.com', now: new Date('2026-09-15T08:00:00+08:00'),
    });
    return {mode: 'upstream-modules', taskId: task.taskId, routeId: route.pointId, scantronId: result.scantronId, steps: result.steps.length};
  }

  async close() {
    await stopProcessTree(this.#process);
  }
}
