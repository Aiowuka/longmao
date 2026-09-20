import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => readFile(join(root, path), 'utf8');

test('Windows bootstrap pins upstream snapshots and fetches them from upstream repositories', async () => {
  const source = await read('scripts/windows/bootstrap.ps1');
  assert.match(source, /https:\/\/github\.com\/yuyuyudlc\/Totoro\.git/);
  assert.match(source, /c499040d52c6e1d45f06f7949419799ccc770db9/);
  assert.match(source, /https:\/\/github\.com\/evi0s\/WMPFDebugger\.git/);
  assert.match(source, /8b1359fa282981a777eea72a4851a3e96674fa9c/);
  assert.match(source, /git\.exe clone/);
  assert.match(source, /git\.exe -C \$Destination fetch origin \$Commit/);
});

test('installer does not package runtime clones, credentials or generated local config', async () => {
  const source = await read('installer/windows/Longmao.iss');
  assert.doesNotMatch(source, /upstreams\\Totoro|upstreams\\WMPFDebugger/);
  assert.match(source, /config\\totoro\.json/);
  assert.match(source, /installer\\windows\\output/);
  assert.match(source, /bootstrap\.ps1/);
});

test('runtime stack remains loopback-only on expected ports', async () => {
  const source = await read('scripts/windows/start.ps1');
  for (const port of ['6379', '3000', '3210', '62000']) assert.match(source, new RegExp(port));
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /npx --yes pnpm@10 start/);
  assert.match(source, /npx --yes pnpm@10 worker:run/);
  assert.match(source, /npx ts-node src\/index\.ts --auto-detect/);
  assert.match(source, /node src\\web\.mjs/);
});

test('first-run config writes Totoro and Longmao to the same owned backend origin', async () => {
  const source = await read('scripts/windows/configure.ps1');
  assert.match(source, /SUNRUN_MINIPROGRAM_BASE_URL=\$BackendOrigin/);
  assert.match(source, /SUNRUN_MINIPROGRAM_FALLBACK_BASE_URL=\$BackendOrigin/);
  assert.match(source, /origin = \$BackendOrigin/);
  assert.match(source, /REDIS_URL=redis:\/\/127\.0\.0\.1:6379/);
});

test('Windows local runtime is stored outside the application directory', async () => {
  const source = await read('scripts/windows/common.ps1');
  assert.match(source, /LOCALAPPDATA/);
  assert.match(source, /LongmaoRuntime/);
});
