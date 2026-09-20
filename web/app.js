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

async function json(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.code || 'REQUEST_FAILED');
  return data;
}

function renderWmpf(wmpf) {
  $('#debug-port').textContent = wmpf.debug.port;
  $('#cdp-port').textContent = wmpf.cdp.port;
  $('#debug-state').textContent = stateLabel(wmpf.debug);
  $('#cdp-state').textContent = stateLabel(wmpf.cdp);
  badge($('#wmpf-badge'), wmpf.ready ? '已连接' : '未就绪', wmpf.ready ? 'safe' : 'warn');
  $('#wmpf-hint').textContent = wmpf.ready
    ? '检测到两个 WMPF 本机端口。当前桥只确认监听状态，不读取调试流量。'
    : '未检测到完整 WMPF 端口组合。可先在 WMPFDebugger 目录运行下方命令。';
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

async function refresh() {
  badge($('#overall-badge'), '检查中', 'neutral');
  try {
    const [status, report, sources] = await Promise.all([
      json('/api/status'),
      json('/api/report'),
      json('/api/sources'),
    ]);
    renderWmpf(status.wmpf);
    renderReport(report.report);
    renderSources(sources.sources);
    $('#runtime').textContent = `Node ${status.node} · ${status.platform} · 127.0.0.1 only`;
    badge($('#overall-badge'), '本地服务正常', 'safe');
  } catch (error) {
    badge($('#overall-badge'), '检查失败', 'danger');
    $('#runtime').textContent = error.message;
  }
}

async function runScenario(scenario, button) {
  const buttons = $$('[data-scenario]');
  buttons.forEach(item => item.disabled = true);
  button.textContent = '运行中…';
  try {
    const result = await json('/api/mock/run', {
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
    button.textContent = button.dataset.label;
  }
}

$('#refresh').addEventListener('click', refresh);
for (const button of $$('[data-scenario]')) {
  button.dataset.label = button.textContent;
  button.addEventListener('click', () => runScenario(button.dataset.scenario, button));
}

refresh();
