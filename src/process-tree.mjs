import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function childIsRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function pidIsRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function stopProcessTree(child) {
  if (!childIsRunning(child)) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true}).catch(() => {});
    await Promise.race([exited, delay(3000)]);
    return;
  }
  let descendants = [];
  try {
    const output = (await execFileAsync('ps', ['-A', '-o', 'pid=,ppid='])).stdout;
    const rows = output.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const pending = [child.pid];
    while (pending.length) {
      const parent = pending.shift();
      const children = rows.filter(([, ppid]) => ppid === parent).map(([pid]) => pid);
      descendants.push(...children);
      pending.push(...children);
    }
  } catch {}
  for (const pid of descendants.reverse()) {
    try { process.kill(pid, 'SIGINT'); } catch {}
  }
  try { child.kill('SIGINT'); } catch { return; }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (childIsRunning(child) || descendants.some(pidIsRunning))) await delay(50);
  const survivors = descendants.filter(pidIsRunning);
  if (childIsRunning(child) || survivors.length) {
    for (const pid of survivors) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    try { child.kill('SIGKILL'); } catch {}
    if (childIsRunning(child)) await exited;
  }
}
