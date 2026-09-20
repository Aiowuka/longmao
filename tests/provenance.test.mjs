import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {validateSourceManifest} from '../src/provenance.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
const fresh = () => structuredClone(manifest);
const invalid = value => assert.throws(() => validateSourceManifest(value), {code: 'INVALID_SOURCE_MANIFEST'});
const cli = (...args) => spawnSync(process.execPath, [join(root, 'src/cli.mjs'), ...args], {cwd: root, encoding: 'utf8', timeout: 10000});

test('validated provenance is returned as an independent copy', () => {
  const result = validateSourceManifest(manifest);
  assert.deepEqual(result, manifest);
  result.sources[0].creditedTo = 'changed';
  assert.notEqual(manifest.sources[0].creditedTo, 'changed');
});

test('both distinct sidecars must be present', () => {
  const duplicate = fresh(); duplicate.sources[1] = duplicate.sources[0]; invalid(duplicate);
  const missing = fresh(); missing.sources.pop(); invalid(missing);
  const unknown = fresh(); unknown.sources[0].repository = 'other/project'; invalid(unknown);
});

test('source snapshots require full commits and canonical URLs', () => {
  const short = fresh(); short.sources[0].commit = 'main'; invalid(short);
  const wrong = fresh(); wrong.sources[0].url = 'https://example.invalid'; invalid(wrong);
});

test('sidecar integration metadata cannot silently become vendored or package runtime dependencies', () => {
  for (const index of [0, 1]) {
    const vendored = fresh(); vendored.sources[index].vendored = true; invalid(vendored);
    const runtime = fresh(); runtime.sources[index].runtimeDependency = true; invalid(runtime);
    const notIntegrated = fresh(); notIntegrated.sources[index].integrated = false; invalid(notIntegrated);
  }
  const totoroKind = fresh(); totoroKind.sources[0].integrationKind = 'copied-core'; invalid(totoroKind);
  const wmpfKind = fresh(); wmpfKind.sources[1].integrationKind = 'vendored'; invalid(wmpfKind);
});

test('sources command reports HTTP Totoro reuse and CDP WMPF reuse', () => {
  const result = cli('sources');
  assert.equal(result.status, 0, result.stderr);
  const sources = JSON.parse(result.stdout).sources;
  const totoro = sources.find(source => source.repository === 'yuyuyudlc/Totoro');
  const wmpf = sources.find(source => source.repository === 'evi0s/WMPFDebugger');
  assert.equal(totoro.integrationKind, 'optional-sidecar-http');
  assert.equal(wmpf.integrationKind, 'optional-sidecar-cdp');
  assert.equal(totoro.vendored, false);
  assert.equal(wmpf.vendored, false);
});

test('invalid metadata dates and shapes fail validation', () => {
  for (const value of [null, [], {}, {schemaVersion: 2}]) invalid(value);
  for (const date of ['yesterday', '2026-02-30', '2026-99-01']) {
    const value = fresh(); value.checkedAt = date; invalid(value);
  }
});

test('sources command rejects extra credential arguments without echoing them', () => {
  const result = cli('sources', '--token', 'PRIVATE-DO-NOT-ECHO');
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-DO-NOT-ECHO/);
});
