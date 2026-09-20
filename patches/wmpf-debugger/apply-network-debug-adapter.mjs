import {readFile, writeFile} from 'node:fs/promises';

const target = process.argv[2];
if (!target) throw new Error('usage: node apply-network-debug-adapter.mjs <WMPFDebugger/src/index.ts>');

let source = await readFile(target, 'utf8');
const marker = 'LONGMAO_WMPF_NETWORK_DEBUG_ADAPTER_V1';
if (source.includes(marker) || source.includes('Longmao.networkDebugAvailable')) {
  console.log('WMPF network debug adapter already applied');
  process.exit(0);
}
if (!source.includes('LONGMAO_WMPF_JSCONTEXT_ROUTING_V1')) {
  throw new Error('WMPF jscontext routing overlay must be applied first');
}

const needle = `        if (unwrappedData.category === "chromeDevtoolsResult") {`;
const pos = source.indexOf(needle);
if (pos < 0) throw new Error('WMPF chromeDevtoolsResult handler marker not found');

const adapter = `        // ${marker}: expose only sanitized network metadata to Longmao.
        if (unwrappedData.category === "networkDebugAPI") {
            debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                method: "Longmao.networkDebugAvailable",
                params: { source: "networkDebugAPI" },
            }));

            let requestObject: any = {};
            try {
                const text = String(unwrappedData.data?.request_headers ?? "");
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) requestObject = parsed;
            } catch {}

            const nestedRequest = requestObject.request && typeof requestObject.request === "object"
                ? requestObject.request
                : {};
            const urlText = String(
                requestObject.url ??
                requestObject.requestUrl ??
                requestObject.request_url ??
                nestedRequest.url ??
                "",
            );
            let origin: string | null = null;
            let path: string | null = null;
            if (urlText) {
                try {
                    const parsedUrl = new URL(urlText);
                    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
                        origin = parsedUrl.origin;
                        path = parsedUrl.pathname;
                    }
                } catch {}
            }
            const method = String(requestObject.method ?? nestedRequest.method ?? "").toUpperCase();
            if (origin || path || method) {
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    method: "Longmao.networkDebug",
                    params: {
                        source: "networkDebugAPI",
                        origin,
                        path,
                        method: /^[A-Z]{1,16}$/.test(method) ? method : null,
                        status: null,
                        phase: String(unwrappedData.data?.api_name ?? "request").slice(0, 64),
                    },
                }));
            }
            return;
        }

        if (unwrappedData.category === "customMessage" &&
            String(unwrappedData.data?.method ?? "") === "__networkDebug") {
            debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                method: "Longmao.networkDebugAvailable",
                params: { source: "__networkDebug" },
            }));

            let payload: any = unwrappedData.data?.payload;
            for (let depth = 0; depth < 3 && typeof payload === "string"; depth += 1) {
                try {
                    const parsed = JSON.parse(payload);
                    if (parsed === payload) break;
                    payload = parsed;
                } catch {
                    break;
                }
            }

            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                const candidates = [
                    payload,
                    payload.data,
                    payload.detail,
                    payload.request,
                    payload.response,
                    payload.data?.request,
                    payload.data?.response,
                ].filter(item => item && typeof item === "object" && !Array.isArray(item));

                const firstValue = (keys: string[]) => {
                    for (const item of candidates) {
                        for (const key of keys) {
                            const value = item[key];
                            if (value !== undefined && value !== null && value !== "") return value;
                        }
                    }
                    return null;
                };

                const urlValue = firstValue([
                    "url", "requestUrl", "request_url", "responseUrl", "response_url", "href",
                ]);
                let origin: string | null = null;
                let path: string | null = null;
                if (typeof urlValue === "string") {
                    try {
                        const parsedUrl = new URL(urlValue);
                        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
                            origin = parsedUrl.origin;
                            path = parsedUrl.pathname;
                        }
                    } catch {}
                }

                const methodValue = firstValue([
                    "method", "httpMethod", "requestMethod", "request_method",
                ]);
                const method = typeof methodValue === "string" ? methodValue.toUpperCase() : null;
                const statusValue = Number(firstValue([
                    "status", "statusCode", "status_code", "httpStatus",
                ]));
                const status = Number.isInteger(statusValue) && statusValue >= 100 && statusValue <= 599
                    ? statusValue
                    : null;
                const phaseValue = firstValue(["phase", "type", "event", "action"]);
                const phase = typeof phaseValue === "string" ? phaseValue.slice(0, 64) : null;

                if (origin || path || method || status || phase) {
                    debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                        method: "Longmao.networkDebug",
                        params: {
                            source: "__networkDebug",
                            origin,
                            path,
                            method: method && /^[A-Z]{1,16}$/.test(method) ? method : null,
                            status,
                            phase,
                        },
                    }));
                }
            }
            return;
        }

`;

source = source.slice(0, pos) + adapter + source.slice(pos);
await writeFile(target, source, 'utf8');
console.log('Applied WMPF safe network debug adapter');
