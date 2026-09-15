import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

function rootPath(root) {
  return root instanceof URL ? fileURLToPath(root) : resolve(root);
}

export async function inspectTotoro({root}) {
  const directory = rootPath(root);
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (pkg.name !== 'totoro' || !pkg.dependencies?.next) throw new Error('INVALID_TOTORO_UPSTREAM');
  await Promise.all([
    readFile(resolve(directory, 'lib/server/token-login.js')),
    readFile(resolve(directory, 'lib/server/sunrun-service.js')),
    readFile(resolve(directory, 'app/api/login/token/route.js')),
  ]);
  return {root: directory, packageVersion: pkg.version, framework: `next@${pkg.dependencies.next}`};
}

export async function loadTotoroModules({root}) {
  const inspected = await inspectTotoro({root});
  const href = relative => pathToFileURL(resolve(inspected.root, relative)).href;
  const [{loginWithToken}, {SunRunService}, {startRun}] = await Promise.all([
    import(href('lib/server/token-login.js')),
    import(href('lib/server/sunrun-service.js')),
    import(href('lib/server/start-run.js')),
  ]);
  return {...inspected, loginWithToken, SunRunService, startRun};
}
