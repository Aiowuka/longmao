import {readFile, writeFile} from 'node:fs/promises';

const target = process.argv[2];
if (!target) throw new Error('usage: node apply-network-only-mode.mjs <WMPFDebugger/src/index.ts>');

let source = await readFile(target, 'utf8');
const marker = 'LONGMAO_WMPF_NETWORK_ONLY_MODE_V1';
if (source.includes(marker)) {
  console.log('WMPF network-only overlay already applied');
  process.exit(0);
}
if (!source.includes('LONGMAO_WMPF_JSCONTEXT_ROUTING_V1')) {
  throw new Error('WMPF jscontext routing overlay must be applied first');
}

const stateNeedle = '    let activeJsContextId = "";';
if (!source.includes(stateNeedle)) throw new Error('WMPF active jscontext marker not found');
source = source.replace(stateNeedle, '    let activeJsContextId = "";\\n' +
  '    // LONGMAO_WMPF_NETWORK_ONLY_MODE_V1\\n' +
  '    let networkOnlySeen = false;\\n' +
  '    const emitNetworkOnlyAvailable = (sourceKind: string) => {\\n' +
  '        if (!networkOnlySeen) {\\n' +
  '            networkOnlySeen = true;\\n' +
  '            logger.info("[miniapp] network-only debug channel detected: " + sourceKind);\\n' +
  '        }\\n' +
  '        debugMessageEmitter.emit("cdpmessage", JSON.stringify({\\n' +
  '            method: "Longmao.networkDebugAvailable",\\n' +
  '            params: { source: sourceKind },\\n' +
  '        }));\\n' +
  '    };');

const messageNeedle = '        if (unwrappedData.category === "addJsContext") {';
if (!source.includes(messageNeedle)) throw new Error('WMPF message routing marker not found');
source = source.replace(messageNeedle,
  '        if (unwrappedData.category === "networkDebugAPI") {\\n' +
  '            emitNetworkOnlyAvailable("networkDebugAPI");\\n' +
  '        }\\n\\n' +
  '        if (\\n' +
  '            unwrappedData.category === "customMessage" &&\\n' +
  '            String(unwrappedData.data?.method ?? "") === "__networkDebug"\\n' +
  '        ) {\\n' +
  '            emitNetworkOnlyAvailable("__networkDebug");\\n' +
  '        }\\n\\n' +
  messageNeedle);

await writeFile(target, source, 'utf8');
console.log('Applied WMPF network-only overlay');
