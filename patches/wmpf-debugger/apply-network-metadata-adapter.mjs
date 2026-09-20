import {readFile, writeFile} from 'node:fs/promises';

const target = process.argv[2];
if (!target) throw new Error('usage: node apply-network-metadata-adapter.mjs <WMPFDebugger/src/index.ts>');

let source = await readFile(target, 'utf8');
const marker = 'LONGMAO_WMPF_NETWORK_METADATA_ADAPTER_V1';
if (source.includes(marker)) {
  console.log('WMPF network metadata adapter already applied');
  process.exit(0);
}
if (!source.includes('LONGMAO_WMPF_NETWORK_ONLY_MODE_V1')) {
  throw new Error('WMPF network-only overlay must be applied first');
}

const stateNeedle = '    const emitNetworkOnlyAvailable = (sourceKind: string) => {';
if (!source.includes(stateNeedle)) throw new Error('WMPF network-only helper marker not found');

const helpers = '    // LONGMAO_WMPF_NETWORK_METADATA_ADAPTER_V1\n' +
'    const parseNetworkObject = (value: unknown): any => {\n' +
'        if (value && typeof value === "object") return value;\n' +
'        if (typeof value !== "string" || value.length > 1024 * 1024) return null;\n' +
'        try {\n' +
'            const parsed = JSON.parse(value);\n' +
'            return parsed && typeof parsed === "object" ? parsed : null;\n' +
'        } catch { return null; }\n' +
'    };\n' +
'    const findNetworkScalar = (root: any, names: string[], depth = 0): any => {\n' +
'        if (!root || typeof root !== "object" || depth > 5) return undefined;\n' +
'        for (const name of names) {\n' +
'            const value = root[name];\n' +
'            if (typeof value === "string" || typeof value === "number") return value;\n' +
'        }\n' +
'        for (const value of Object.values(root)) {\n' +
'            if (value && typeof value === "object") {\n' +
'                const found = findNetworkScalar(value, names, depth + 1);\n' +
'                if (found !== undefined) return found;\n' +
'            }\n' +
'        }\n' +
'        return undefined;\n' +
'    };\n' +
'    const emitNetworkMetadata = (sourceKind: string, raw: unknown) => {\n' +
'        const root = parseNetworkObject(raw);\n' +
'        if (!root) return;\n' +
'        const rawUrl = findNetworkScalar(root, ["url", "requestUrl", "request_url", "uri"]);\n' +
'        let origin: string | null = null;\n' +
'        let path: string | null = null;\n' +
'        if (typeof rawUrl === "string") {\n' +
'            try {\n' +
'                const url = new URL(rawUrl);\n' +
'                if (url.protocol === "http:" || url.protocol === "https:") {\n' +
'                    origin = url.origin;\n' +
'                    path = url.pathname;\n' +
'                }\n' +
'            } catch {}\n' +
'        }\n' +
'        const rawMethod = findNetworkScalar(root, ["method", "httpMethod", "requestMethod"]);\n' +
'        const method = typeof rawMethod === "string" && /^[A-Za-z]{1,16}$/.test(rawMethod)\n' +
'            ? rawMethod.toUpperCase() : null;\n' +
'        const rawStatus = Number(findNetworkScalar(root, ["status", "statusCode", "httpStatus"]));\n' +
'        const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599\n' +
'            ? rawStatus : null;\n' +
'        const rawPhase = findNetworkScalar(root, ["phase", "type", "event", "eventName"]);\n' +
'        const phase = typeof rawPhase === "string" && rawPhase.length <= 64 ? rawPhase : null;\n' +
'        if (origin === null && path === null && method === null && status === null && phase === null) return;\n' +
'        debugMessageEmitter.emit("cdpmessage", JSON.stringify({\n' +
'            method: "Longmao.networkDebug",\n' +
'            params: { source: sourceKind, origin, path, method, status, phase },\n' +
'        }));\n' +
'    };\n\n';

source = source.replace(stateNeedle, helpers + stateNeedle);

source = source.replace(
'        if (unwrappedData.category === "networkDebugAPI") {\n' +
'            emitNetworkOnlyAvailable("networkDebugAPI");\n' +
'        }',
'        if (unwrappedData.category === "networkDebugAPI") {\n' +
'            emitNetworkOnlyAvailable("networkDebugAPI");\n' +
'            emitNetworkMetadata("networkDebugAPI", unwrappedData.data?.request_headers);\n' +
'        }'
);

source = source.replace(
'            emitNetworkOnlyAvailable("__networkDebug");\n' +
'        }',
'            emitNetworkOnlyAvailable("__networkDebug");\n' +
'            emitNetworkMetadata("__networkDebug", unwrappedData.data?.payload);\n' +
'        }'
);

await writeFile(target, source, 'utf8');
console.log('Applied WMPF sanitized network metadata adapter');
