import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {LabError, runDemo, SCENARIOS} from './lab.mjs';
import {validateSourceManifest} from './provenance.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const help = `longmao-local-lab — OFFLINE MOCK ONLY

node src/cli.mjs doctor
node src/cli.mjs sources
node src/cli.mjs demo [--scenario success|expired-session|rejected-submission]
node src/cli.mjs help

No WeChat launch, debugger connection, token extraction or external submission.
The fixture is not a production API contract. No npm install is required.
`;

async function loadSources() {
  const manifest = JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
  return validateSourceManifest(manifest);
}

async function saveReport(report) {
  const directory = join(root, 'artifacts');
  await mkdir(directory, {recursive: true});
  const temporary = join(directory, `.report-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', {encoding: 'utf8', flag: 'wx', mode: 0o600});
    await rename(temporary, join(directory, 'last-report.json'));
  } finally {
    await rm(temporary, {force: true});
  }
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command) && args.length === 0) {
    console.log(help);
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new LabError('NODE_22_OR_NEWER_REQUIRED');
  if (command === 'sources' && args.length === 0) {
    console.log(JSON.stringify(await loadSources(), null, 2));
    return;
  }
  if (command === 'doctor' && args.length === 0) {
    const manifest = await loadSources();
    console.log(JSON.stringify({
      mode: 'offline-mock', node: process.versions.node, platform: process.platform,
      externalConnections: false, runtimeDependencies: 0,
      sourceReferences: manifest.sources.map(({repository, commit, creditedTo, integrated}) => ({repository, commit, creditedTo, integrated})),
      upstreamCompatibility: 'NOT_TESTED — no upstream code is executed',
    }, null, 2));
    return;
  }
  if (command !== 'demo') throw new LabError('INVALID_COMMAND');
  let scenario = 'success';
  if (args.length !== 0) {
    if (args.length !== 2 || args[0] !== '--scenario' || !SCENARIOS.includes(args[1])) throw new LabError('INVALID_ARGUMENTS');
    scenario = args[1];
  }
  const report = runDemo({scenario});
  await saveReport(report);
  console.log(JSON.stringify(report, null, 2));
  console.log('Local report: artifacts/last-report.json');
  if (!report.ok) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({ok: false, code: error instanceof LabError ? error.code : 'LOCAL_IO_OR_RUNTIME_ERROR'}));
  process.exitCode = 1;
}
