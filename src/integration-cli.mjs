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
import {LabBackend} from './lab-backend/server.mjs';
import {BridgeController} from './bridge/controller.mjs';
import {childIsRunning, stopProcessTree} from './process-tree.mjs';

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
    credentials: 'never persisted', productionTransport: 'blocked',
  };
}

async function run() {
  const startedAt = new Date().toISOString();
  const status = await doctor();
  if (!status.node) throw new Error('NODE_22_OR_NEWER_REQUIRED');
  if (!status.wechat) throw new Error('WECHAT_PROCESS_NOT_DETECTED');
  if (!status.upstreams.every(upstream => upstream.matches)) throw new Error('UPSTREAM_COMMIT_MISMATCH');
  const backend = new LabBackend();
  let wmpfProcess;
  let adapter;
  let client;
  let wmpfExited = new Promise(() => {});
  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const onSignal = () => rejectAbort(new Error('INTEGRATION_INTERRUPTED'));
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await backend.start();
    console.log('Local contract backend healthy');
    adapter = new TotoroAdapter({root: totoroRoot, backendUrl: backend.url});
    await adapter.start();
    console.log('Totoro native backend loaded');
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
    const controller = new BridgeController({observer, adapter, mode: 'native'});
    controller.start();
    const completed = new Promise((resolveDone, rejectDone) => {
      controller.once('completed', resolveDone);
      controller.once('failed', () => rejectDone(new Error('TOTORO_WORKFLOW_FAILED')));
    });
    const onStatus = current => {
      if (!current.lastEventType) return;
      controller.removeListener('status', onStatus);
      console.log(`miniapp target detected (${current.lastEventType})`);
    };
    controller.on('status', onStatus);
    const runtimeReady = new Promise(resolveReady => client.once('ready', resolveReady));
    await client.connect();
    console.log('WMPF connected');
    console.log('Waiting for miniapp runtime event...');
    await within([
      runtimeReady,
      completed,
      aborted,
      wmpfExited,
    ], 300000, 'MINIAPP_EVENT_TIMEOUT');
    console.log('runtime attached');
    console.log('network observer active');
    const result = await within([
      completed,
      aborted,
      wmpfExited,
    ], 60000, 'TOTORO_WORKFLOW_TIMEOUT');
    const report = {
      schemaVersion: 1, mode: 'real-wmpf-native-totoro', ok: true, startedAt,
      finishedAt: new Date().toISOString(), upstreamTransport: 'loopback-only', credentialValue: 'never persisted',
      credentialPresent: result.session.credentialPresent, session: result.session, totoro: result.result,
    };
    await saveReport(report);
    console.log('Pipeline completed');
    console.log('Sanitized report: artifacts/integration-report.json');
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    client?.close();
    await adapter?.close();
    await backend.close().catch(() => {});
    await stopProcessTree(wmpfProcess);
  }
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--doctor') console.log(JSON.stringify(await doctor(), null, 2));
  else if (process.argv.length === 2) await run();
  else throw new Error('INVALID_ARGUMENTS');
} catch (error) {
  console.error(JSON.stringify({ok: false, code: error?.message || 'INTEGRATION_FAILED'}));
  process.exitCode = 1;
}
