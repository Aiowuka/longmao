const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function badge(element, text, kind = 'neutral') {
  element.textContent = text;
  element.className = `badge ${kind}`;
}

async function request(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`HTTP_${response.status}`); }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.code || `HTTP_${response.status}`);
    error.data = data;
    throw error;
  }
  return data;
}

async function post(url, body) {
  const options = {method: 'POST'};
  if (body !== undefined) {
    options.headers = {'Content-Type': 'application/json'};
    options.body = JSON.stringify(body);
  }
  return request(url, options);
}

function stateLabel(probe) {
  if (probe.reachable) return `监听中 · ${probe.latencyMs}ms`;
  if (probe.state === 'timeout') return '超时';
  if (probe.state === 'closed') return '未监听';
  return '不可达';
}

function renderWmpf(wmpf) {
  $('#debug-port').textContent = wmpf.debug.port;
  $('#cdp-port').textContent = wmpf.cdp.port;
  $('#debug-state').textContent = stateLabel(wmpf.debug);
  $('#cdp-state').textContent = stateLabel(wmpf.cdp);
  badge($('#wmpf-badge'), wmpf.ready ? '已就绪' : '未就绪', wmpf.ready ? 'safe' : 'warn');
}

function renderCdp(cdp) {
  if (!cdp) return;
  const waitingTarget = cdp.connected && !cdp.instrumented && cdp.targetRetrying;
  badge($('#cdp-badge'),
    cdp.connected ? (cdp.instrumented ? '已接入' : (waitingTarget ? '等待小程序' : '已连接')) : cdp.state,
    cdp.connected ? (cdp.instrumented ? 'safe' : 'warn') : 'neutral');
  $('#cdp-instrumented').textContent = cdp.instrumented
    ? 'Network / Runtime / Page'
    : (waitingTarget
      ? `等待小程序目标 · 自动重试 ${cdp.targetRetryCount || 0}/${cdp.targetRetryLimit || 0}`
      : (cdp.lastError || '否'));
  $('#capture-origin').textContent = cdp.captureOrigin || '—';
  $('#cdp-event-count').textContent = String(cdp.eventCount || 0);
  $('#cdp-token').textContent = cdp.auth?.present
    ? `${cdp.auth.preview} · ${cdp.auth.length} chars · ${cdp.auth.source}`
    : (cdp.authRetrying ? `等待登录态 · 自动重试 ${cdp.authRetryCount || 0}/${cdp.authRetryLimit || 0}` : '未捕获');
  const keys = Array.isArray(cdp.storageKeys) ? cdp.storageKeys : [];
  $('#storage-keys').textContent = keys.length ? keys.join(', ') : '—';
}

function renderTotoro(status) {
  const config = status.config;
  const runtime = status.runtime;
  const health = status.health;
  if (!config?.configured) {
    badge($('#totoro-badge'), config?.error ? '配置错误' : '未配置', config?.error ? 'danger' : 'warn');
    $('#totoro-base').textContent = config?.error || '复制 config/totoro.example.json';
    $('#totoro-health').textContent = '—';
    $('#totoro-profile').textContent = '—';
    $('#totoro-task-count').textContent = '0';
    $('#totoro-last-run').textContent = '—';
    renderTaskSelectors([]);
    return;
  }

  $('#totoro-base').textContent = config.baseUrl;
  $('#capture-origin').textContent = config.captureOrigin;
  $('#totoro-health').textContent = health
    ? (health.reachable ? `在线 · HTTP ${health.status} · ${health.latencyMs}ms` : (health.code || '不可达'))
    : '—';
  const profile = runtime?.profile;
  $('#totoro-profile').textContent = profile
    ? [profile.stuName, profile.stuNumber, profile.schoolName, profile.campusName].filter(Boolean).join(' · ')
    : '未同步';
  $('#totoro-task-count').textContent = String(runtime?.tasks?.length || 0);
  $('#totoro-last-run').textContent = runtime?.lastRun
    ? `${runtime.lastRun.mode || 'result'} · ${runtime.lastRun.jobId || runtime.lastRun.scantronId || 'done'}`
    : '—';

  const authReady = Boolean(status.auth?.present);
  const ready = Boolean(health?.reachable);
  badge($('#totoro-badge'), !ready ? '未启动' : (authReady ? '可同步' : '等待 Token'),
    !ready ? 'warn' : (authReady ? 'safe' : 'warn'));
  renderTaskSelectors(runtime?.tasks || [], runtime?.selection);
  renderPreview(runtime?.preview || null);
  renderStart(runtime?.lastRun || null);
}

function renderTaskSelectors(tasks, selection = null) {
  const taskSelect = $('#task-select');
  const currentTask = selection?.taskId || taskSelect.value;
  taskSelect.replaceChildren();
  if (!tasks.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '先同步 Totoro';
    taskSelect.append(option);
    taskSelect.disabled = true;
    $('#route-select').disabled = true;
    $('#preview-button').disabled = true;
    return;
  }

  for (const task of tasks) {
    const option = document.createElement('option');
    option.value = String(task.taskId);
    option.textContent = [task.name || task.taskId, task.mileage ? `${task.mileage}km` : ''].filter(Boolean).join(' · ');
    taskSelect.append(option);
  }
  taskSelect.disabled = false;
  if (tasks.some(task => String(task.taskId) === String(currentTask))) taskSelect.value = String(currentTask);
  renderRoutes(tasks, selection?.routeId || '');
}

function renderRoutes(tasks, selectedRoute = '') {
  const task = tasks.find(item => String(item.taskId) === String($('#task-select').value));
  const routes = Array.isArray(task?.runPointList) ? task.runPointList : [];
  const routeSelect = $('#route-select');
  routeSelect.replaceChildren();

  if (!task) {
    routeSelect.disabled = true;
    $('#preview-button').disabled = true;
    return;
  }

  if (!routes.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '无固定路线';
    routeSelect.append(option);
    routeSelect.disabled = true;
  } else {
    for (const route of routes) {
      const option = document.createElement('option');
      option.value = String(route.pointId);
      option.textContent = route.pointName || route.pointId;
      routeSelect.append(option);
    }
    routeSelect.disabled = false;
    if (routes.some(route => String(route.pointId) === String(selectedRoute))) routeSelect.value = String(selectedRoute);
  }
  $('#preview-button').disabled = false;
}

function renderPreview(preview) {
  if (!preview) {
    $('#preview-output').textContent = '尚未生成。';
    $('#start-button').disabled = true;
    badge($('#flow-badge'), '等待 Preview', 'neutral');
    return;
  }
  $('#preview-output').textContent = JSON.stringify(preview, null, 2);
  $('#start-button').disabled = false;
  badge($('#flow-badge'), 'Preview 就绪', 'safe');
}

function renderStart(result) {
  $('#start-output').textContent = result ? JSON.stringify(result, null, 2) : '尚未开始。';
  if (result) badge($('#flow-badge'), result.mode === 'queued' ? '已进入 Totoro 队列' : 'Totoro 已执行', 'safe');
}

function renderMock(report) {
  if (!report) {
    badge($('#run-badge'), '暂无', 'neutral');
    $('#report').textContent = '尚未运行。';
    return;
  }
  badge($('#run-badge'), report.ok ? 'PASS' : 'EXPECTED FAIL', report.ok ? 'safe' : 'warn');
  $('#report').textContent = JSON.stringify(report, null, 2);
}

function renderSources(sources) {
  const root = $('#sources');
  root.replaceChildren();
  for (const source of sources) {
    const card = document.createElement('article');
    card.className = 'source';
    const name = document.createElement('strong');
    name.textContent = source.name;
    const repo = document.createElement('code');
    repo.textContent = source.repository;
    const role = document.createElement('p');
    role.textContent = source.referenceRole;
    const meta = document.createElement('small');
    meta.textContent = `${source.integrationKind} · vendored: ${source.vendored ? 'yes' : 'no'}`;
    card.append(name, repo, role, meta);
    root.append(card);
  }
}

function renderEvents(events) {
  const root = $('#events');
  root.replaceChildren();
  if (!events.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '暂无事件。';
    root.append(empty);
    return;
  }
  for (const event of events) {
    const row = document.createElement('div');
    row.className = 'event-row';
    const left = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = event.kind;
    const detail = document.createElement('span');
    if (event.kind === 'request') detail.textContent = `${event.method || ''} ${event.path || ''}`;
    else if (event.kind === 'response') detail.textContent = `${event.status || ''} ${event.path || ''}`;
    else if (event.kind === 'auth_captured') detail.textContent = `${event.source} · ${event.tokenLength} chars`;
    else if (event.kind === 'console') detail.textContent = `${event.level} · args ${event.argumentCount}`;
    else if (event.kind === 'navigation') detail.textContent = event.url || '';
    else if (event.kind === 'network_seen') {
      const verb = event.direction === 'request' ? (event.method || 'REQ') : (event.status || 'RESP');
      const mark = event.matchedCaptureOrigin ? ' · capture origin' : '';
      detail.textContent = `${verb} ${event.origin || ''}${event.path || ''}${mark}`;
    }
    else if (event.kind === 'cdp_instrument_retry') detail.textContent = `attempt ${event.attempt}/${event.limit}`;
    else if (event.kind === 'cdp_instrumented') detail.textContent = 'Network / Runtime / Page ready';
    else if (event.kind === 'runtime_context') detail.textContent = `context ${event.contextId} · ${event.name || 'unnamed'} · ${event.origin || 'no-origin'}`;
    else if (event.kind === 'wx_context_found') detail.textContent = `context ${event.contextId ?? 'default'} · wx ready · storage keys ${event.storageKeyCount || 0}`;
    else if (event.kind === 'runtime_context_probe_failed') detail.textContent = `context ${event.contextId ?? 'default'} · ${event.code || 'probe failed'}`;
    else if (event.kind === 'wmpf_jscontexts') detail.textContent = `${event.count || 0} miniapp JS contexts`;
    else if (event.kind === 'wmpf_jscontext_added') detail.textContent = `${event.id} · ${event.name || 'unnamed'}`;
    else if (event.kind === 'wmpf_jscontext_removed') detail.textContent = event.id || '';
    else if (event.kind === 'wmpf_jscontext_connected') detail.textContent = event.id || '';
    else if (event.kind === 'wmpf_jscontext_selected') detail.textContent = `${event.id} · ${event.name || 'unnamed'}`;
    else if (event.kind === 'wmpf_jscontext_probe_failed') detail.textContent = `${event.id} · ${event.code || 'probe failed'}`;
    else if (event.kind === 'auth_storage_capture_failed') detail.textContent = event.code || 'storage read failed';
    else if (event.kind === 'auth_storage_retry') detail.textContent = `attempt ${event.attempt}/${event.limit}`;
    else detail.textContent = event.code || '';
    const time = document.createElement('time');
    time.textContent = event.at ? new Date(event.at).toLocaleTimeString() : '';
    left.append(title, detail);
    row.append(left, time);
    root.append(row);
  }
}

async function refreshEvents() {
  try {
    const data = await request('/api/cdp/events?limit=120');
    renderEvents(data.events);
  } catch {
    renderEvents([]);
  }
}

async function refresh() {
  badge($('#overall-badge'), '检查中', 'neutral');
  try {
    const [status, totoro, report, sources] = await Promise.all([
      request('/api/status'),
      request('/api/totoro/status'),
      request('/api/report'),
      request('/api/sources'),
    ]);
    renderWmpf(status.wmpf);
    renderCdp(status.cdp);
    renderTotoro(totoro);
    renderMock(report.report);
    renderSources(sources.sources);
    $('#runtime').textContent = `Node ${status.node} · ${status.platform} · 127.0.0.1 only`;
    badge($('#overall-badge'), 'Longmao 正常', 'safe');
    await refreshEvents();
  } catch (error) {
    badge($('#overall-badge'), '检查失败', 'danger');
    $('#runtime').textContent = error.message;
  }
}

async function cdpAction(path) {
  try {
    const result = await post(path);
    renderCdp(result.cdp);
    await refresh();
  } catch (error) {
    badge($('#cdp-badge'), error.message, 'danger');
  }
}

async function totoroSync() {
  const button = $('#totoro-sync');
  button.disabled = true;
  button.textContent = '同步中…';
  try {
    const data = await post('/api/totoro/sync');
    renderTotoro({config: (await request('/api/totoro/status')).config, runtime: data.runtime,
      health: {reachable: true, status: 200, latencyMs: 0}, auth: {present: true}});
    await refresh();
  } catch (error) {
    badge($('#totoro-badge'), error.message, 'danger');
  } finally {
    button.disabled = false;
    button.textContent = '用捕获 Token 同步 Totoro';
  }
}

async function createPreview() {
  const taskId = $('#task-select').value;
  const routeId = $('#route-select').value || '';
  $('#preview-button').disabled = true;
  badge($('#flow-badge'), '生成中', 'warn');
  try {
    const data = await post('/api/totoro/preview', {taskId, routeId});
    renderPreview(data.runtime.preview);
    renderTaskSelectors(data.runtime.tasks, data.runtime.selection);
  } catch (error) {
    badge($('#flow-badge'), error.message, 'danger');
    $('#preview-output').textContent = JSON.stringify(error.data || {code: error.message}, null, 2);
  } finally {
    $('#preview-button').disabled = false;
  }
}

async function startTotoro() {
  $('#start-button').disabled = true;
  badge($('#flow-badge'), 'Totoro 执行中', 'warn');
  try {
    const data = await post('/api/totoro/start');
    renderStart(data.runtime.lastRun);
    await loadJobs();
  } catch (error) {
    badge($('#flow-badge'), error.message, 'danger');
    $('#start-output').textContent = JSON.stringify(error.data || {code: error.message}, null, 2);
    $('#start-button').disabled = false;
  }
}

async function loadJobs() {
  const output = $('#jobs-output');
  output.textContent = '读取中…';
  try {
    const data = await request('/api/totoro/jobs');
    output.textContent = JSON.stringify(data.jobs, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify(error.data || {code: error.message}, null, 2);
  }
}

async function runMock(scenario, button) {
  const buttons = $$('[data-scenario]');
  buttons.forEach(item => item.disabled = true);
  const original = button.textContent;
  button.textContent = '运行中…';
  try {
    const data = await post('/api/mock/run', {scenario});
    renderMock(data.report);
  } catch (error) {
    badge($('#run-badge'), 'ERROR', 'danger');
    $('#report').textContent = JSON.stringify(error.data || {code: error.message}, null, 2);
  } finally {
    buttons.forEach(item => item.disabled = false);
    button.textContent = original;
  }
}

$('#refresh').addEventListener('click', refresh);
$('#cdp-connect').addEventListener('click', () => cdpAction('/api/cdp/connect'));
$('#cdp-disconnect').addEventListener('click', () => cdpAction('/api/cdp/disconnect'));
$('#cdp-clear-auth').addEventListener('click', () => cdpAction('/api/cdp/auth/clear'));
$('#totoro-sync').addEventListener('click', totoroSync);
$('#totoro-jobs').addEventListener('click', loadJobs);
$('#task-select').addEventListener('change', async () => {
  const status = await request('/api/totoro/status');
  renderRoutes(status.runtime?.tasks || [], '');
  renderPreview(null);
});
$('#route-select').addEventListener('change', () => renderPreview(null));
$('#preview-button').addEventListener('click', createPreview);
$('#start-button').addEventListener('click', startTotoro);
$('#events-refresh').addEventListener('click', refreshEvents);
$('#events-clear').addEventListener('click', async () => {
  await cdpAction('/api/cdp/events/clear');
  renderEvents([]);
});
for (const button of $$('[data-scenario]')) {
  button.addEventListener('click', () => runMock(button.dataset.scenario, button));
}

refresh();
