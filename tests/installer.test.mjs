import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
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
  assert.match(source, /wmpf-supervisor\.sh/);
  assert.doesNotMatch(source, /src\/index\.ts --auto-detect/);
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
  assert.match(source, /wmpf-supervisor\.sh/);
  assert.doesNotMatch(source, /src\/index\.ts --auto-detect/);
  assert.match(source, /ptrace_scope/);
});

test('Linux WMPF supervisor waits for WeChatAppEx and restarts upstream debugger', async () => {
  const source = await read('scripts/linux/wmpf-supervisor.sh');
  assert.match(source, /WeChatAppEx/);
  assert.match(source, /exec npx ts-node src\/index\.ts/);
  assert.match(source, /trap shutdown INT TERM EXIT/);
  assert.match(source, /WMPFDebugger 已退出/);
});


test('WMPFDebugger dependencies follow upstream Yarn lockfile', async () => {
  const install = await read('scripts/linux/install.sh');
  const repair = await read('scripts/linux/repair.sh');
  for (const source of [install, repair]) {
    assert.match(source, /yarn@1\.22\.22 install --frozen-lockfile/);
    assert.doesNotMatch(source, /\bnpm install\b/);
  }
});


test('Longmao carries an explicit WMPF Linux legacy scene pointer patch', async () => {
  const patch = await read('patches/wmpf-debugger/0001-fix-legacy-scene-pointer.patch');
  assert.match(patch, /-\s*miniappScenePtr = remoteDebugParametersPtr\.add/);
  assert.match(patch, /\+\s*miniappScenePtr = remoteDebugConfigPtr\.add/);
  for (const path of ['scripts/linux/install.sh', 'scripts/linux/repair.sh']) {
    const source = await read(path);
    assert.match(source, /apply_wmpf_patches/);
    assert.match(source, /git -C "\$LONGMAO_WMPF" apply --check/);
  }
});


test('WMPF JSContext routing overlay preserves and selects miniapp jscontext_id', async () => {
  const patcher = await read('patches/wmpf-debugger/apply-jscontext-routing.mjs');
  assert.match(patcher, /LONGMAO_WMPF_JSCONTEXT_ROUTING_V1/);
  assert.match(patcher, /addJsContext/);
  assert.match(patcher, /Longmao\.getJsContexts/);
  assert.match(patcher, /Longmao\.connectJsContext/);
  assert.match(patcher, /jscontext_id: activeJsContextId/);

  for (const path of ['scripts/linux/install.sh', 'scripts/linux/repair.sh']) {
    const source = await read(path);
    assert.match(source, /apply-jscontext-routing\.mjs/);
    assert.match(source, /node "\$jscontext_patcher" "\$LONGMAO_WMPF\/src\/index\.ts"/);
  }
});


test('supervisor self-heals the known legacy Linux scene pointer bug', async () => {
  const source = await read('scripts/linux/wmpf-supervisor.sh');
  assert.match(source, /repair_known_legacy_pointer_bug/);
  assert.match(source, /remoteDebugParametersPtr\.add\(structOffsets\\\[5\\\]\)/);
  assert.match(source, /remoteDebugConfigPtr\.add\(structOffsets\[5\]\)/);
  assert.match(source, /sed -i/);
});


test('safe miniapp diagnostics overlay upgrades existing WMPF routing patches', async () => {
  const patcher = await read('patches/wmpf-debugger/apply-miniapp-diagnostics.mjs');
  assert.match(patcher, /LONGMAO_WMPF_MINIAPP_DIAGNOSTICS_V1/);
  assert.match(patcher, /Longmao\.getMiniappMessages/);
  assert.match(patcher, /recentMiniappMessages/);
  assert.match(patcher, /Object\.keys\(data\)/);

  for (const path of ['scripts/linux/install.sh', 'scripts/linux/repair.sh']) {
    const source = await read(path);
    assert.match(source, /apply-miniapp-diagnostics\.mjs/);
    assert.match(source, /node "\$diagnostics_patcher" "\$LONGMAO_WMPF\/src\/index\.ts"/);
  }
});


test('result-envelope jscontext inference supports Linux WeChat builds without addJsContext', async () => {
  const patcher = await read('patches/wmpf-debugger/apply-result-jscontext-inference.mjs');
  assert.match(patcher, /LONGMAO_WMPF_RESULT_JSCONTEXT_INFERENCE_V1/);
  assert.match(patcher, /chromeDevtoolsResult/);
  assert.match(patcher, /jscontext_id/);
  assert.match(patcher, /inferred-from-chromeDevtoolsResult/);
  assert.match(patcher, /Longmao\.jsContextAdded/);

  for (const path of ['scripts/linux/install.sh', 'scripts/linux/repair.sh']) {
    const source = await read(path);
    assert.match(source, /apply-result-jscontext-inference\.mjs/);
    assert.match(source, /node "\$result_context_patcher" "\$LONGMAO_WMPF\/src\/index\.ts"/);
  }
});


test('network-only capability overlay detects Linux WeChat network debug channels', async () => {
  const patcher = await read('patches/wmpf-debugger/apply-network-only-mode.mjs');
  assert.match(patcher, /LONGMAO_WMPF_NETWORK_ONLY_MODE_V1/);
  assert.match(patcher, /Longmao\.networkDebugAvailable/);
  assert.match(patcher, /__networkDebug/);
  assert.match(patcher, /networkDebugAPI/);

  for (const path of ['scripts/linux/install.sh', 'scripts/linux/repair.sh']) {
    const source = await read(path);
    assert.match(source, /apply-network-only-mode\.mjs/);
    assert.match(source, /node "\$network_only_patcher" "\$LONGMAO_WMPF\/src\/index\.ts"/);
  }
});


test('sanitized network metadata adapter never forwards headers, bodies, cookies or query values', async () => {
  const patcher = await read('patches/wmpf-debugger/apply-network-metadata-adapter.mjs');
  assert.match(patcher, /LONGMAO_WMPF_NETWORK_METADATA_ADAPTER_V1/);
  assert.match(patcher, /Longmao\.networkDebug/);
  assert.match(patcher, /url\.origin/);
  assert.match(patcher, /url\.pathname/);
  assert.doesNotMatch(patcher, /authorization|cookie|set-cookie/i);

  for (const path of ['scripts/linux/install.sh', 'scripts/linux/repair.sh']) {
    const source = await read(path);
    assert.match(source, /apply-network-metadata-adapter\.mjs/);
    assert.match(source, /node "\$network_metadata_patcher" "\$LONGMAO_WMPF\/src\/index\.ts"/);
  }
});


test('WMPF overlay patchers emit real source newlines when applied', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'longmao-wmpf-patcher-'));
  const target = join(dir, 'index.ts');
  try {
    await writeFile(target, [
      '// LONGMAO_WMPF_JSCONTEXT_ROUTING_V1',
      'const debugMessageEmitter = { emit() {} };',
      'const logger = { info() {} };',
      'const jsContexts = new Map<string, string>();',
      '    let activeJsContextId = "";',
      'function onMessage(unwrappedData: any) {',
      '        if (unwrappedData.category === "addJsContext") {',
      '            return;',
      '        }',
      '}',
      '',
    ].join('\n'));

    for (const patcher of [
      'patches/wmpf-debugger/apply-network-only-mode.mjs',
      'patches/wmpf-debugger/apply-network-metadata-adapter.mjs',
    ]) {
      const result = spawnSync(process.execPath, [join(root, patcher), target], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }

    const patched = await readFile(target, 'utf8');
    assert.match(patched, /LONGMAO_WMPF_NETWORK_ONLY_MODE_V1/);
    assert.match(patched, /LONGMAO_WMPF_NETWORK_METADATA_ADAPTER_V1/);
    assert.match(patched, /let networkOnlySeen = false;\n/);
    assert.match(patched, /const emitNetworkOnlyAvailable = \(sourceKind: string\) => \{/);
    assert.match(patched, /const parseNetworkObject = .*\n\s+const findNetworkScalar/s);
    assert.doesNotMatch(patched, /\\\\n/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});


test('network-only adapter upgrades an existing WMPF routing overlay safely', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'longmao-network-adapter-'));
  try {
    const target = join(temp, 'index.ts');
    const fixture = [
      'const debugMessageEmitter = { emit() {} };',
      'async function demo(unwrappedData) {',
      '  // LONGMAO_WMPF_JSCONTEXT_ROUTING_V1',
      '  if (unwrappedData.category === "chromeDevtoolsResult") {',
      '    // need to proxy to CDP client',
      '    debugMessageEmitter.emit("cdpmessage", unwrappedData.data.payload);',
      '  }',
      '}',
      '',
    ].join('\n');
    await writeFile(target, fixture);

    const result = spawnSync(process.execPath, [
      join(root, 'patches/wmpf-debugger/apply-network-debug-adapter.mjs'),
      target,
    ], {encoding: 'utf8'});

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const patched = await readFile(target, 'utf8');
    assert.match(patched, /LONGMAO_WMPF_NETWORK_DEBUG_ADAPTER_V1/);
    assert.match(patched, /Longmao\.networkDebugAvailable/);
    assert.match(patched, /Longmao\.networkDebug/);
    assert.match(patched, /__networkDebug/);
    assert.match(patched, /networkDebugAPI/);
    assert.doesNotMatch(patched, /params:\s*\{[^}]*payload/s);
    assert.doesNotMatch(patched, /params:\s*\{[^}]*request_headers/s);
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
});

test('Linux install and repair always apply the WMPF network-only adapter', async () => {
  for (const path of ['scripts/linux/install.sh', 'scripts/linux/repair.sh']) {
    const source = await read(path);
    assert.match(source, /apply-network-debug-adapter\.mjs/);
    assert.match(source, /node "\$network_debug_patcher" "\$LONGMAO_WMPF\/src\/index\.ts"/);
  }
});
