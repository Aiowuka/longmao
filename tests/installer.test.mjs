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

test('Windows installer does not package runtime clones, credentials or generated local config', async () => {
  const source = await read('installer/windows/Longmao.iss');
  assert.doesNotMatch(source, /upstreams\\Totoro|upstreams\\WMPFDebugger/);
  assert.match(source, /config\\totoro\.json/);
  assert.match(source, /installer\\windows\\output/);
  assert.match(source, /bootstrap\.ps1/);
});

test('Windows runtime stack remains loopback-only on expected ports', async () => {
  const source = await read('scripts/windows/start.ps1');
  for (const port of ['6379', '3000', '3210', '62000']) assert.match(source, new RegExp(port));
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /npx --yes pnpm@10 start/);
  assert.match(source, /npx --yes pnpm@10 worker:run/);
  assert.match(source, /npx ts-node src\/index\.ts --auto-detect/);
  assert.match(source, /node src\\web\.mjs/);
});

test('Windows first-run config writes Totoro and Longmao to the same owned backend origin', async () => {
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

test('Linux installer pins upstream snapshots and fetches them from upstream repositories', async () => {
  const source = await read('scripts/linux/install.sh');
  assert.match(source, /https:\/\/github\.com\/yuyuyudlc\/Totoro\.git/);
  assert.match(source, /c499040d52c6e1d45f06f7949419799ccc770db9/);
  assert.match(source, /https:\/\/github\.com\/evi0s\/WMPFDebugger\.git/);
  assert.match(source, /8b1359fa282981a777eea72a4851a3e96674fa9c/);
  assert.match(source, /git clone --filter=blob:none --no-checkout/);
  assert.match(source, /git -C "\$dest" fetch origin "\$commit" --depth 1/);
});

test('Linux private Node 22 download verifies official SHA-256 before extraction', async () => {
  const source = await read('scripts/linux/install.sh');
  assert.match(source, /nodejs\.org\/dist\/latest-v22\.x\/SHASUMS256\.txt/);
  assert.match(source, /sha256sum "\$tmp\/\$file"/);
  assert.match(source, /\[\[ "\$actual" == "\$expected" \]\]/);
  assert.match(source, /tar -xJf "\$tmp\/\$file" --strip-components=1/);
});

test('Linux runtime is user-scoped and keeps config separate from install files', async () => {
  const source = await read('scripts/linux/common.sh');
  assert.match(source, /\.local\/opt\/longmao/);
  assert.match(source, /\.local\/share/);
  assert.match(source, /\.config/);
  assert.match(source, /\.local\/bin/);
});

test('Linux runtime stack is loopback-only and delegates business logic to Totoro', async () => {
  const source = await read('scripts/linux/start.sh');
  for (const port of ['6379', '3000', '3210', '62000']) assert.match(source, new RegExp(port));
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /pnpm@10 start/);
  assert.match(source, /pnpm@10 worker:run/);
  assert.match(source, /npx ts-node src\/index\.ts --auto-detect/);
  assert.match(source, /node src\/web\.mjs/);
});

test('Linux first-run config points Totoro and Longmao at the same backend origin', async () => {
  const source = await read('scripts/linux/configure.sh');
  assert.match(source, /SUNRUN_MINIPROGRAM_BASE_URL=\$backend_origin/);
  assert.match(source, /SUNRUN_MINIPROGRAM_FALLBACK_BASE_URL=\$backend_origin/);
  assert.match(source, /"origin": "\$backend_origin"/);
  assert.match(source, /REDIS_URL=redis:\/\/127\.0\.0\.1:6379/);
});

test('Linux uninstaller removes only Longmao-owned trees and intentionally keeps distro packages', async () => {
  const source = await read('scripts/linux/uninstall.sh');
  assert.match(source, /rm -rf "\$LONGMAO_RUNTIME_ROOT_RESOLVED"/);
  assert.match(source, /rm -rf "\$LONGMAO_INSTALL_ROOT_RESOLVED"/);
  assert.match(source, /rm -rf "\$LONGMAO_CONFIG_ROOT_RESOLVED"/);
  assert.match(source, /--keep-config/);
  assert.doesNotMatch(source, /apt(?:-get)?\s+(?:remove|purge)|dnf\s+remove|pacman\s+-R/);
});

test('Linux .run build excludes local config and generated installer output', async () => {
  const source = await read('installer/linux/build.sh');
  assert.match(source, /--exclude='config\/totoro\.json'/);
  assert.match(source, /--exclude='installer\/linux\/output'/);
  assert.match(source, /makeself/);
  assert.match(source, /scripts\/linux\/install\.sh/);
});


test('Linux exposes one unified longmao subcommand CLI', async () => {
  const cli = await read('scripts/linux/longmao.sh');
  for (const command of ['start', 'stop', 'restart', 'status', 'configure', 'repair', 'logs', 'open', 'version', 'uninstall', 'help']) {
    assert.match(cli, new RegExp('\\b' + command.replace('-', '\\-') + '\\b'));
  }
  assert.match(cli, /Usage:/);
  assert.match(cli, /VERSION='0\.5\.0'/);
  assert.match(cli, /printf 'Longmao %s\\n' \"\$VERSION\"/);
});

test('Linux installer makes longmao the primary command and keeps legacy wrappers as aliases', async () => {
  const source = await read('scripts/linux/install.sh');
  assert.match(source, /scripts\/linux\/longmao\.sh/);
  assert.match(source, /longmao" "\$action"/);
  assert.match(source, /longmao start/);
  assert.match(source, /longmao uninstall/);
});


test('public curl bootstrap pins a tested public source snapshot', async () => {
  const source = await read('install.sh');
  assert.match(source, /REPO='Aiowuka\/longmao'/);
  assert.match(source, /DEFAULT_REF='6d0d52ef2124c4142a9877bb6915b916e98a0bb9'/);
  assert.match(source, /https:\/\/github\.com\/\$REPO\/archive\/\$REF\.tar\.gz/);
  assert.match(source, /--proto '=https'/);
  assert.match(source, /scripts\/linux\/install\.sh/);
  assert.doesNotMatch(source, /token|Authorization:|GITHUB_TOKEN/i);
});


test('Linux managed processes inherit the Longmao private runtime PATH', async () => {
  const source = await read('scripts/linux/common.sh');
  assert.match(source, /nohup bash -c "\$command"/);
  assert.doesNotMatch(source, /nohup bash -lc/);
  assert.match(source, /export PATH="\$LONGMAO_NODE_ROOT\/bin:\$LONGMAO_BIN_ROOT_RESOLVED:\$PATH"/);
});


test('Linux managed commands support leading environment assignments', async () => {
  const source = await read('scripts/linux/common.sh');
  assert.match(source, /nohup bash -c "\$command"/);
  assert.doesNotMatch(source, /bash -c "exec \$command"/);
});


test('Linux WMPF launch uses upstream Linux version configs instead of Windows auto-detect', async () => {
  const source = await read('scripts/linux/start.sh');
  assert.match(source, /npx ts-node src\/index\.ts/);
  assert.doesNotMatch(source, /src\/index\.ts --auto-detect/);
  assert.match(source, /ptrace_scope/);
});


test('WMPFDebugger dependencies follow upstream Yarn lockfile', async () => {
  const install = await read('scripts/linux/install.sh');
  const repair = await read('scripts/linux/repair.sh');
  for (const source of [install, repair]) {
    assert.match(source, /yarn@1\.22\.22 install --frozen-lockfile/);
    assert.doesNotMatch(source, /\bnpm install\b/);
  }
});
