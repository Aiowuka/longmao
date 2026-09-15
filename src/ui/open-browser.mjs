import {spawn} from 'node:child_process';

export function openBrowser(url, {spawnImpl = spawn, timeoutMs = 5000} = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('BROWSER_URL_MUST_BE_LOOPBACK');
  }
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', 'start', '', parsed.href];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [parsed.href];
  } else {
    command = 'xdg-open';
    args = [parsed.href];
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {stdio: 'ignore', windowsHide: true, detached: true});
    } catch (error) {
      reject(new Error('BROWSER_OPEN_FAILED', {cause: error}));
      return;
    }
    let settled = false;
    let timer;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.once('error', error => finish(new Error('BROWSER_OPEN_FAILED', {cause: error})));
    child.once('exit', code => finish(code === 0 ? null : new Error('BROWSER_OPEN_FAILED')));
    timer = setTimeout(() => finish(), timeoutMs);
    timer.unref();
    child.unref?.();
  });
}
