const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function badge(element, text, kind = 'neutral') {
  element.textContent = text;
  element.className = `badge ${kind}`;
}

function stateLabel(probe) {
  if (probe.reachable) return `监听中 · ${probe.latencyMs}ms`;
  if (probe.state === 'timeout') return '超时';
  if (probe.state === 'closed') return '未监听';
  return '不可达';
}

async function request(url, options) {
  const response = await fetch(url, options);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`HTTP_${response.status}`);
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.code || `HTTP_${response.status}`);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function post(url) {
  return request(url, {method: 'POST'});
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
  const kind = cdp.connected ? (cdp.instrumented ? 'safe' : 'warn') : 'neutral';
  badge($('#cdp-badge'), cdp.connected ? (cdp.instrumented ? '已接入' : '已连接') : cdp.state, kind);
  $('#cdp-instrumented').textContent = cdp.instrumented ? 'Network / Runtime / Page 已启用' : (cdp.lastError || '否');
  $('#cdp-page').textContent = cdp.currentPage || '—';
  $('#cdp-event-count').textContent = String(cdp.eventCount || 0);
  $('#cdp-token').textContent = cdp.auth?.present
    ? `${cdp.auth.preview} · ${cdp.auth.length} chars · ${cdp.auth.source}`
    : '未捕获';
}

function renderBackend(status) {
  const backend = status.backend;
  const runtime = status.runtime;
  const auth = status.auth;
  if (!backend?.configured) {
    badge($('#backend-badge'), backend?.error ? '配置错误' : '未配置', backend?.error ? 'danger' : 'warn');
    $('#backend-origin').textContent = backend?.error || '复制 config/backend.example.json';
    $('#backend-config-path').textContent = backend?.configPath || '—';
    $('#backend-auth').textContent = '—';
    $('#backend-latest').textContent = '—';
    return;
  }
  badge($('#backend-badge'), auth?.present ? '可运行' : '等待登录', auth?.present ? 'safe' : 'warn');
  $('#backend-origin').textContent = backend.origin;
  $('#backend-config-path').textContent = backend.configPath || '—';
  $('#backend-auth').textContent = auth?.present ? `已捕获 ${auth.preview}` : '等待 CDP 捕获';
  $('#backend-latest').textContent = runtime?.latestRun
    ? `${runtime.latestRun.ok ? 'PASS' : 'FAIL'} · ${runtime.latestRun.runId || 'no run id'}`
    : '—';
}

function renderReport(report) {
  if (!report) {
    badge($('#run-badge'), '暂无', 'neutral');
    $('#report').textContent = '尚未运行。';
    return;
  }
  badge($('#run-badge'), report.ok ? 'PASS' : 'EXPECTED FAIL', report.ok ? 'safe' : 'warn');
  $('#report').textContent = JSON.stringify(report, null, 2);
}

function renderRealReport(report) {
  if (!report) {
    badge($('#real-run-badge'), '等待', 'neutral');
    $('#real-report').textContent = '尚未运行。';
    return;
  }
  badge($('#real-run-badge'), report.ok ? 'PASS' : 'FAIL', report.ok ? 'safe' : 'danger');
  $('#real-report').textContent = JSON.stringify(report, null, 2);
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
    meta.textContent = `${source.creditedTo} · runtime dependency: ${source.runtimeDependency ? 'yes' : 'no'}`;
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
  } catch (error) {
    renderEvents([]);
  }
}

async function refresh() {
  badge($('#overall-badge'), '检查中', 'neutral');
  try {
    const [status, report, sources, backend, real] = await Promise.all([
      request('/api/status'),
      request('/api/report'),
      request('/api/sources'),
      request('/api/backend/status'),
      request('/api/backend/report').catch(() => ({report: null})),
    ]);
    renderWmpf(status.wmpf);
    renderCdp(status.cdp);
    renderBackend(backend);
    renderReport(report.report);
    renderRealReport(real.report);
    renderSources(sources.sources);
    $('#runtime').textContent = `Node ${status.node} · ${status.platform} · 127.0.0.1 only`;
    badge($('#overall-badge'), '本地服务正常', 'safe');
    await refreshEvents();
  } catch (error) {
    badge($('#overall-badge'), '检查失败', 'danger');
    $('#runtime').textContent = error.message;
  }
}

async function runMock(scenario, button) {
  const buttons = $$('[data-scenario]');
  buttons.forEach(item => item.disabled = true);
  const original = button.textContent;
  button.textContent = '运行中…';
  try {
    const result = await request('/api/mock/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({scenario}),
    });
    renderReport(result.report);
  } catch (error) {
    badge($('#run-badge'), 'ERROR', 'danger');
    $('#report').textContent = JSON.stringify({ok: false, code: error.message}, null, 2);
  } finally {
    buttons.forEach(item => item.disabled = false);
    button.textContent = original;
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

async function readBackend(kind) {
  const output = $('#backend-data');
  output.textContent = '读取中…';
  try {
    const data = await request(`/api/backend/${kind}`);
    output.textContent = JSON.stringify(data[kind], null, 2);
  } catch (error) {
    output.textContent = JSON.stringify({ok: false, code: error.message}, null, 2);
  }
}

async function runSelfHosted(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = {
    taskId: String(form.get('taskId') || ''),
    distanceMeters: Number(form.get('distanceMeters')),
    durationSeconds: Number(form.get('durationSeconds')),
    centerLat: Number(form.get('centerLat')),
    centerLon: Number(form.get('centerLon')),
  };
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = '运行中…';
  badge($('#real-run-badge'), 'RUNNING', 'warn');
  $('#real-report').textContent = '正在执行 profile → tasks → generate → start → submit → receipt…';
  try {
    const response = await fetch('/api/backend/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (data.report) renderRealReport(data.report);
    if (!response.ok || !data.ok) throw Object.assign(new Error(data.code || 'RUN_FAILED'), {data});
    await refresh();
  } catch (error) {
    if (!error.data?.report) {
      badge($('#real-run-badge'), 'FAIL', 'danger');
      $('#real-report').textContent = JSON.stringify({ok: false, code: error.message}, null, 2);
    }
  } finally {
    submit.disabled = false;
    submit.textContent = '开始完整链路';
  }
}

$('#refresh').addEventListener('click', refresh);
$('#cdp-connect').addEventListener('click', () => cdpAction('/api/cdp/connect'));
$('#cdp-disconnect').addEventListener('click', () => cdpAction('/api/cdp/disconnect'));
$('#cdp-clear-auth').addEventListener('click', () => cdpAction('/api/cdp/auth/clear'));
$('#events-refresh').addEventListener('click', refreshEvents);
$('#events-clear').addEventListener('click', async () => {
  await cdpAction('/api/cdp/events/clear');
  renderEvents([]);
});
$('#backend-profile').addEventListener('click', () => readBackend('profile'));
$('#backend-tasks').addEventListener('click', () => readBackend('tasks'));
$('#run-form').addEventListener('submit', runSelfHosted);

for (const button of $$('[data-scenario]')) {
  button.addEventListener('click', () => runMock(button.dataset.scenario, button));
}

refresh();
