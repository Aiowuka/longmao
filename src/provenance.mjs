import {LabError} from './lab.mjs';

const repositories = new Set(['yuyuyudlc/Totoro', 'evi0s/WMPFDebugger']);
const plainObject = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

/** Validate reference metadata only. This never downloads or executes upstream code. */
export function validateSourceManifest(manifest) {
  const fail = () => { throw new LabError('INVALID_SOURCE_MANIFEST'); };
  if (!plainObject(manifest) || manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.sources) || manifest.sources.length !== repositories.size ||
      typeof manifest.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.checkedAt)) fail();
  const date = new Date(`${manifest.checkedAt}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== manifest.checkedAt) fail();
  const seen = new Set();
  for (const source of manifest.sources) {
    if (!plainObject(source) || !repositories.has(source.repository) || seen.has(source.repository) ||
        source.url !== `https://github.com/${source.repository}` ||
        typeof source.commit !== 'string' || !/^[a-f0-9]{40}$/.test(source.commit) ||
        !nonempty(source.creditedTo) || !nonempty(source.licenseStatus) || !nonempty(source.license) || !nonempty(source.integrationRole) ||
        source.vendored !== false || source.runtimeDependency !== true || source.integrated !== true) fail();
    seen.add(source.repository);
  }
  return structuredClone(manifest);
}
