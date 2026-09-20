import {readFile, writeFile} from 'node:fs/promises';

const target = process.argv[2];
if (!target) throw new Error('usage: node apply-miniapp-diagnostics.mjs <WMPFDebugger/src/index.ts>');

let source = await readFile(target, 'utf8');
const marker = 'LONGMAO_WMPF_MINIAPP_DIAGNOSTICS_V1';
if (source.includes(marker)) {
  console.log('WMPF miniapp diagnostics already applied');
  process.exit(0);
}
if (!source.includes('LONGMAO_WMPF_JSCONTEXT_ROUTING_V1')) {
  throw new Error('WMPF jscontext routing overlay must be applied first');
}

const stateNeedle = '    const jsContexts = new Map<string, string>();\n    let activeJsContextId = "";';
if (!source.includes(stateNeedle)) throw new Error('WMPF jscontext state marker not found');
source = source.replace(stateNeedle, `    const jsContexts = new Map<string, string>();
    // ${marker}: keep only category names and data key names, never payload values.
    const recentMiniappMessages: Array<{ category: string; keys: string[] }> = [];
    let activeJsContextId = "";`);

const messageNeedle = `        if (unwrappedData === null) {
            return;
        }

        if (unwrappedData.category === "addJsContext") {`;
if (!source.includes(messageNeedle)) throw new Error('WMPF miniapp message marker not found');
source = source.replace(messageNeedle, `        if (unwrappedData === null) {
            return;
        }

        const safeCategory = String(unwrappedData.category ?? "");
        if (safeCategory) {
            const data = unwrappedData.data && typeof unwrappedData.data === "object"
                ? unwrappedData.data
                : {};
            recentMiniappMessages.push({
                category: safeCategory,
                keys: Object.keys(data).sort().slice(0, 24),
            });
            if (recentMiniappMessages.length > 120) recentMiniappMessages.shift();
        }

        if (unwrappedData.category === "addJsContext") {`);

const proxyNeedle = `        if (parsed?.method === "Longmao.connectJsContext") {`;
if (!source.includes(proxyNeedle)) throw new Error('WMPF connect jscontext marker not found');
source = source.replace(proxyNeedle, `        if (parsed?.method === "Longmao.getMiniappMessages") {
            if (Number.isInteger(parsed.id)) {
                const counts = new Map<string, number>();
                for (const item of recentMiniappMessages) {
                    counts.set(item.category, (counts.get(item.category) || 0) + 1);
                }
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    id: parsed.id,
                    result: {
                        recent: recentMiniappMessages.slice(-60),
                        categoryCounts: Array.from(counts.entries())
                            .map(([category, count]) => ({ category, count }))
                            .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
                    },
                }));
            }
            return;
        }

        if (parsed?.method === "Longmao.connectJsContext") {`);

await writeFile(target, source, 'utf8');
console.log('Applied WMPF safe miniapp diagnostics');
