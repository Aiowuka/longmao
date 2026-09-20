import {readFile, writeFile} from 'node:fs/promises';

const target = process.argv[2];
if (!target) throw new Error('usage: node apply-result-jscontext-inference.mjs <WMPFDebugger/src/index.ts>');

let source = await readFile(target, 'utf8');
const marker = 'LONGMAO_WMPF_RESULT_JSCONTEXT_INFERENCE_V1';
if (source.includes(marker) || source.includes('inferred-from-chromeDevtoolsResult')) {
  console.log('WMPF chromeDevtoolsResult jscontext inference already applied');
  process.exit(0);
}
if (!source.includes('LONGMAO_WMPF_JSCONTEXT_ROUTING_V1')) {
  throw new Error('WMPF jscontext routing overlay must be applied first');
}

const needle = `        if (unwrappedData.category === "chromeDevtoolsResult") {
            // need to proxy to CDP client
            debugMessageEmitter.emit("cdpmessage", unwrappedData.data.payload);
        }`;

if (!source.includes(needle)) {
  throw new Error('WMPF chromeDevtoolsResult forwarding marker not found');
}

const replacement = `        if (unwrappedData.category === "chromeDevtoolsResult") {
            // ${marker}: some Linux WeChat builds omit addJsContext but still
            // populate jscontext_id on every chromeDevtoolsResult envelope.
            const resultJsContextId = String(unwrappedData.data?.jscontext_id ?? "");
            if (resultJsContextId && !jsContexts.has(resultJsContextId)) {
                const inferredName = "inferred-from-chromeDevtoolsResult";
                jsContexts.set(resultJsContextId, inferredName);
                if (!activeJsContextId) activeJsContextId = resultJsContextId;
                logger.info(
                    \`[miniapp] inferred jscontext from chromeDevtoolsResult: id=\${resultJsContextId}\`,
                );
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    method: "Longmao.jsContextAdded",
                    params: { id: resultJsContextId, name: inferredName },
                }));
            }
            // need to proxy to CDP client
            debugMessageEmitter.emit("cdpmessage", unwrappedData.data.payload);
        }`;

source = source.replace(needle, replacement);
await writeFile(target, source, 'utf8');
console.log('Applied WMPF chromeDevtoolsResult jscontext inference');
