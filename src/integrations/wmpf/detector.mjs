import {connect} from 'node:net';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import WebSocket from 'ws';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const execFileAsync = promisify(execFile);

export async function isPortReady({host = '127.0.0.1', port = 62000, timeoutMs = 750} = {}) {
  return new Promise(resolve => {
    const socket = connect({host, port});
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function isWebSocketReady({endpoint = 'ws://127.0.0.1:62000', timeoutMs = 1000} = {}) {
  return new Promise(resolve => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket.readyState < WebSocket.CLOSING) socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('open', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function processList() {
  try {
    if (process.platform === 'win32') {
      const command = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.Name)`t$($_.CommandLine)" }';
      return (await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {windowsHide: true})).stdout;
    }
    return (await execFileAsync('ps', ['-A', '-o', 'comm=,args='])).stdout;
  } catch { return ''; }
}

export async function detectIntegrationPrerequisites({port = 62000} = {}) {
  const list = await processList();
  let ptraceScope = null;
  if (process.platform === 'linux') {
    try { ptraceScope = Number((await readFile('/proc/sys/kernel/yama/ptrace_scope', 'utf8')).trim()); } catch {}
  }
  const cdpPort = await isPortReady({port});
  const wmpfProcess = /WMPFDebugger.*(?:src[\\/]index\.ts|ts-node)/i.test(list);
  const websocketEndpoint = cdpPort && await isWebSocketReady({endpoint: `ws://127.0.0.1:${port}`});
  return {
    node: Number(process.versions.node.split('.')[0]) >= 22,
    wechat: /WeChat|Weixin|WeChatAppEx/i.test(list),
    wmpfProcess,
    wmpfDebugger: websocketEndpoint && wmpfProcess,
    cdpPort,
    websocketEndpoint,
    ptraceScope,
    fridaAttachLikelyAllowed: ptraceScope === null || ptraceScope === 0,
  };
}

export function startWmpfDebugger({root, autoDetect = true} = {}) {
  if (!root) throw new Error('WMPF_ROOT_REQUIRED');
  const tsNode = resolve(root, 'node_modules/ts-node/dist/bin.js');
  if (!existsSync(tsNode)) throw new Error('WMPFDEBUGGER_DEPENDENCIES_MISSING');
  const args = [tsNode, 'src/index.ts'];
  if (autoDetect) args.push('--auto-detect');
  return spawn(process.execPath, args, {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
  });
}
