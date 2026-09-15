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

test('both distinct upstream repositories must be present', () => {
  const duplicate = fresh(); duplicate.sources[1] = duplicate.sources[0]; invalid(duplicate);
  const missing = fresh(); missing.sources.pop(); invalid(missing);
  const unknown = fresh(); unknown.sources[0].repository = 'other/project'; invalid(unknown);
});

test('source references require a full commit and correct repository URL', () => {
  const short = fresh(); short.sources[0].commit = 'main'; invalid(short);
  const wrong = fresh(); wrong.sources[0].url = 'https://example.invalid'; invalid(wrong);
});

test('attribution and integrated status cannot be silently omitted', () => {
  const missing = fresh(); delete missing.sources[0].creditedTo; invalid(missing);
  const blank = fresh(); blank.sources[0].creditedTo = ' '; invalid(blank);
  const vendored = fresh(); vendored.sources[0].vendored = true; invalid(vendored);
  for (const field of ['runtimeDependency', 'integrated']) {
    const changed = fresh(); changed.sources[0][field] = false; invalid(changed);
  }
  const license = fresh(); delete license.sources[0].licenseStatus; invalid(license);
  const licenseName = fresh(); delete licenseName.sources[0].license; invalid(licenseName);
  const role = fresh(); delete role.sources[0].integrationRole; invalid(role);
});

test('invalid metadata dates and shapes fail validation', () => {
  for (const value of [null, [], {}, {schemaVersion: 2}]) invalid(value);
  for (const date of ['yesterday', '2026-02-30', '2026-99-01']) {
    const value = fresh(); value.checkedAt = date; invalid(value);
  }
});

test('sources command displays both credited reference snapshots', () => {
  const result = cli('sources');
  assert.equal(result.status, 0, result.stderr);
  const sources = JSON.parse(result.stdout).sources;
  assert.equal(sources.length, 2);
  assert.match(sources[0].creditedTo, /yuyuyudlc/);
  assert.match(sources[1].creditedTo, /evi0s/);
  assert.ok(sources.every(source => source.integrated === true));
});

test('sources command rejects extra credential arguments without echoing them', () => {
  const result = cli('sources', '--token', 'PRIVATE-DO-NOT-ECHO');
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-DO-NOT-ECHO/);
});
