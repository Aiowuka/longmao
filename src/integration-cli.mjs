import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CdpClient} from './integrations/wmpf/cdp-client.mjs';
import {detectIntegrationPrerequisites, isPortReady, startWmpfDebugger} from './integrations/wmpf/detector.mjs';
import {WmpfObserver} from './integrations/wmpf/observer.mjs';
import {TotoroAdapter} from './integrations/totoro/adapter.mjs';
import {BridgeController} from './bridge/controller.mjs';
import {childIsRunning, stopProcessTree} from './process-tree.mjs';
import {TotoroUiProxy} from './ui/totoro-proxy.mjs';
import {openBrowser} from './ui/open-browser.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(projectRoot);
const totoroRoot = resolve(process.env.TOTORO_ROOT || resolve(workspaceRoot, 'Totoro'));
const wmpfRoot = resolve(process.env.WMPFDEBUGGER_ROOT || resolve(workspaceRoot, 'WMPFDebugger'));
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const execFileAsync = promisify(execFile);

async function within(promises, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([...promises, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function checkoutStatus() {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, 'upstreams.lock.json'), 'utf8'));
  const roots = new Map([['yuyuyudlc/Totoro', totoroRoot], ['evi0s/WMPFDebugger', wmpfRoot]]);
  return Promise.all(manifest.sources.map(async source => {
    let actual = null;
    let clean = false;
    try {
      actual = (await execFileAsync('git', ['rev-parse', 'HEAD'], {cwd: roots.get(source.repository)})).stdout.trim();
      clean = (await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd: roots.get(source.repository)})).stdout.trim() === '';
    } catch {}
    return {repository: source.repository, expected: source.commit, actual, clean, matches: actual === source.commit && clean};
  }));
}

async function saveReport(report) {
  const directory = resolve(projectRoot, 'artifacts');
  await mkdir(directory, {recursive: true});
  const temporary = resolve(directory, `.integration-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    await rename(temporary, resolve(directory, 'integration-report.json'));
  } finally { await rm(temporary, {force: true}); }
}

async function waitForPort(port, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && !childIsRunning(child)) throw new Error('WMPFDEBUGGER_EXITED_BEFORE_CDP_READY');
    if (await isPortReady({port})) return;
    await delay(250);
  }
  throw new Error('WMPF_CDP_PORT_TIMEOUT');
}

async function doctor() {
  const prerequisites = await detectIntegrationPrerequisites();
  const upstreams = await checkoutStatus();
  const adapter = new TotoroAdapter({root: totoroRoot});
  let totoro;
  try { totoro = await adapter.inspect(); } catch { totoro = {error: 'TOTORO_UPSTREAM_NOT_READY'}; }
  return {
    mode: 'real-wmpf-native-totoro', node: process.versions.node, platform: process.platform,
    ...prerequisites, upstreams, totoro: {...totoro, root: totoroRoot}, wmpfRoot,
    credentials: 'not persisted by longmao', productionTransport: 'Totoro native behavior',
  };
}

async function run() {
  const startedAt = new Date().toISOString();
  const status = await doctor();
  if (!status.node) throw new Error('NODE_22_OR_NEWER_REQUIRED');
  if (!status.wechat) throw new Error('WECHAT_PROCESS_NOT_DETECTED');
  if (!status.upstreams.every(upstream => upstream.matches)) throw new Error('UPSTREAM_COMMIT_MISMATCH');
  let wmpfProcess;
  let adapter;
  let uiProxy;
  let client;
  let wmpfExited = new Promise(() => {});
  let resolveStop;
  const stopped = new Promise(resolveStopped => { resolveStop = resolveStopped; });
  const interrupted = stopped.then(() => { throw new Error('INTEGRATION_INTERRUPTED'); });
  const onSignal = () => resolveStop();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let primaryError;
  try {
    adapter = new TotoroAdapter({root: totoroRoot, transport: 'native'});
    await adapter.start();
    console.log('Totoro native service loaded');
    uiProxy = new TotoroUiProxy({upstreamUrl: adapter.url});
    await uiProxy.start();
    if (process.env.LONGMAO_NO_BROWSER !== '1') {
      await openBrowser(uiProxy.url);
      console.log(`Totoro UI opened: ${uiProxy.origin}`);
    } else {
      console.log(`Totoro UI ready (browser launch disabled): ${uiProxy.origin}`);
    }
    if (!status.wmpfDebugger) {
      if (status.cdpPort) throw new Error('CDP_PORT_OCCUPIED_BY_UNKNOWN_PROCESS');
      wmpfProcess = startWmpfDebugger({root: wmpfRoot});
      wmpfExited = new Promise((_resolve, reject) => wmpfProcess.once('exit', () => {
        reject(new Error(process.platform === 'linux' && !status.fridaAttachLikelyAllowed
          ? 'FRIDA_ATTACH_BLOCKED_BY_PTRACE_SCOPE'
          : 'WMPFDEBUGGER_EXITED'));
      }));
      wmpfProcess.stdout.on('data', () => {});
      wmpfProcess.stderr.on('data', () => {});
      try { await waitForPort(62000, wmpfProcess); }
      catch (error) {
        if (process.platform === 'linux' && !status.fridaAttachLikelyAllowed) throw new Error('FRIDA_ATTACH_BLOCKED_BY_PTRACE_SCOPE', {cause: error});
        throw error;
      }
    }
    client = new CdpClient();
    const observer = new WmpfObserver(client);
    const controller = new BridgeController({observer, adapter, mode: 'disabled'});
    controller.start();
    let firstCredentialCaptured = false;
    const onCredential = token => {
      uiProxy.offerCredential(token);
      if (!firstCredentialCaptured) {
        firstCredentialCaptured = true;
        resolveFirstCredential();
      }
    };
    let resolveFirstCredential;
    const credentialCaptured = new Promise(resolveCredential => {
      resolveFirstCredential = resolveCredential;
    });
    observer.on('credential', onCredential);
    const dashboardReady = new Promise(resolveReady => uiProxy.once('dashboardReady', resolveReady));
    const onStatus = current => {
      if (!current.lastEventType) return;
      controller.removeListener('status', onStatus);
      console.log(`miniapp target detected (${current.lastEventType})`);
    };
    controller.on('status', onStatus);
    client.once('ready', () => {
      console.log('runtime attached');
      console.log('network observer active');
    });
    await client.connect();
    console.log('WMPF connected');
    console.log('Waiting for authenticated Totoro miniapp request...');
    await within([
      credentialCaptured,
      interrupted,
      wmpfExited,
    ], 300000, 'MINIAPP_CREDENTIAL_TIMEOUT');
    console.log('credential detected and held in memory');
    await within([
      dashboardReady,
      interrupted,
      wmpfExited,
    ], 60000, 'TOTORO_UI_HANDOFF_TIMEOUT');
    observer.removeListener('credential', onCredential);
    const report = {
      schemaVersion: 1, mode: 'real-wmpf-native-totoro-ui', ok: true, startedAt,
      finishedAt: new Date().toISOString(), upstreamTransport: 'Totoro native behavior', credentialValue: 'not persisted by longmao',
      credentialPresent: true, session: controller.context.snapshot(), totoro: {mode: 'native-next-dashboard', url: uiProxy.origin},
    };
    await saveReport(report);
    console.log('Credential handed to Totoro; dashboard ready');
    console.log('Sanitized report: artifacts/integration-report.json');
    console.log('Press Ctrl+C to stop the local product.');
    await stopped;
  } catch (error) {
    primaryError = error;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => client?.close()),
      Promise.resolve().then(() => uiProxy?.close()),
      Promise.resolve().then(() => adapter?.close()),
      Promise.resolve().then(() => stopProcessTree(wmpfProcess)),
    ]);
    const failures = cleanup.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) {
      primaryError = new AggregateError(primaryError ? [primaryError, ...failures] : failures, 'INTEGRATION_CLEANUP_FAILED');
    }
  }
  if (primaryError) throw primaryError;
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--doctor') console.log(JSON.stringify(await doctor(), null, 2));
  else if (process.argv.length === 2) await run();
  else throw new Error('INVALID_ARGUMENTS');
} catch (error) {
  console.error(JSON.stringify({ok: false, code: error?.message || 'INTEGRATION_FAILED'}));
  process.exitCode = 1;
}
