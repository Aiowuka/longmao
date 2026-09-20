import {LabError} from './lab.mjs';

const expected = new Map([
  ['yuyuyudlc/Totoro', {integrated: false, integrationKind: 'reference-only'}],
  ['evi0s/WMPFDebugger', {integrated: true, integrationKind: 'optional-sidecar-cdp'}],
]);
const plainObject = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

/** Validate attribution/interoperability metadata only. This never downloads or executes upstream code. */
export function validateSourceManifest(manifest) {
  const fail = () => { throw new LabError('INVALID_SOURCE_MANIFEST'); };
  if (!plainObject(manifest) || manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.sources) || manifest.sources.length !== expected.size ||
      typeof manifest.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.checkedAt)) fail();
  const date = new Date(`${manifest.checkedAt}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== manifest.checkedAt) fail();

  const seen = new Set();
  for (const source of manifest.sources) {
    const rule = expected.get(source?.repository);
    if (!plainObject(source) || !rule || seen.has(source.repository) ||
        source.url !== `https://github.com/${source.repository}` ||
        typeof source.commit !== 'string' || !/^[a-f0-9]{40}$/.test(source.commit) ||
        !nonempty(source.creditedTo) || !nonempty(source.licenseStatus) || !nonempty(source.referenceRole) ||
        source.vendored !== false || source.runtimeDependency !== false ||
        source.integrated !== rule.integrated || source.integrationKind !== rule.integrationKind) fail();
    seen.add(source.repository);
  }
  return structuredClone(manifest);
}
