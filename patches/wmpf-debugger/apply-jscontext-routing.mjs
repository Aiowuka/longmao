import {readFile, writeFile} from 'node:fs/promises';

const target = process.argv[2];
if (!target) throw new Error('usage: node apply-jscontext-routing.mjs <WMPFDebugger/src/index.ts>');

let source = await readFile(target, 'utf8');
const marker = 'LONGMAO_WMPF_JSCONTEXT_ROUTING_V1';
if (source.includes(marker)) {
  console.log('WMPF jscontext routing patch already applied');
  process.exit(0);
}

const counterNeedle = '    let messageCounter = 0;\n';
if (!source.includes(counterNeedle)) throw new Error('WMPF index.ts messageCounter marker not found');
source = source.replace(counterNeedle, `    let messageCounter = 0;
    // ${marker}: preserve WeChat remote-debug JS context routing.
    // The upstream protobuf already carries addJsContext/connectJsContext/jscontext_id,
    // but the stock proxy drops those signals and sends CDP with an empty jscontext_id.
    const jsContexts = new Map<string, string>();
    const recentMiniappMessages: Array<{ category: string; keys: string[] }> = [];
    let activeJsContextId = "";
`);

const messageNeedle = `        if (unwrappedData === null) {
            return;
        }

        if (unwrappedData.category === "chromeDevtoolsResult") {
`;
if (!source.includes(messageNeedle)) throw new Error('WMPF index.ts onMessage marker not found');
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

        if (unwrappedData.category === "addJsContext") {
            const contextId = String(unwrappedData.data?.jscontext_id ?? "");
            const contextName = String(unwrappedData.data?.jscontext_name ?? "");
            if (contextId) {
                jsContexts.set(contextId, contextName);
                if (!activeJsContextId) activeJsContextId = contextId;
                logger.info(\`[miniapp] jscontext added: id=\${contextId} name=\${contextName}\`);
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    method: "Longmao.jsContextAdded",
                    params: { id: contextId, name: contextName },
                }));
            }
            return;
        }

        if (unwrappedData.category === "removeJsContext") {
            const contextId = String(unwrappedData.data?.jscontext_id ?? "");
            if (contextId) {
                jsContexts.delete(contextId);
                if (activeJsContextId === contextId) activeJsContextId = "";
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    method: "Longmao.jsContextRemoved",
                    params: { id: contextId },
                }));
            }
            return;
        }

        if (unwrappedData.category === "connectJsContext") {
            const contextId = String(unwrappedData.data?.jscontext_id ?? "");
            if (contextId) {
                activeJsContextId = contextId;
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    method: "Longmao.jsContextConnected",
                    params: { id: contextId },
                }));
            }
            return;
        }

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

        if (unwrappedData.category === "chromeDevtoolsResult") {
            const resultJsContextId = String(unwrappedData.data?.jscontext_id ?? "");
            if (resultJsContextId && !jsContexts.has(resultJsContextId)) {
                const inferredName = "inferred-from-chromeDevtoolsResult";
                jsContexts.set(resultJsContextId, inferredName);
                if (!activeJsContextId) activeJsContextId = resultJsContextId;
                logger.info(\`[miniapp] inferred jscontext from chromeDevtoolsResult: id=\${resultJsContextId}\`);
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    method: "Longmao.jsContextAdded",
                    params: { id: resultJsContextId, name: inferredName },
                }));
            }
`);

const proxyNeedle = `    debugMessageEmitter.on("proxymessage", (message: string) => {
        wss &&
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    // encode CDP and send to miniapp
                    // wrapDebugMessageData(data, category, compressAlgo)
                    const rawPayload = {
                        jscontext_id: "",
                        op_id: Math.round(100 * Math.random()),
                        payload: message.toString(),
                    };
                    logger.main_debug(rawPayload);
                    const wrappedData = codex.wrapDebugMessageData(
                        rawPayload,
                        "chromeDevtools",
                        0,
                    );
                    const outData = {
                        seq: ++messageCounter,
                        category: "chromeDevtools",
                        data: wrappedData.buffer,
                        compressAlgo: 0,
                        originalSize: wrappedData.originalSize,
                    };
                    const encodedData =
                        messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(
                            outData,
                        ).finish();
                    client.send(encodedData, { binary: true });
                }
            });
    });
`;
if (!source.includes(proxyNeedle)) throw new Error('WMPF index.ts proxymessage marker not found');
source = source.replace(proxyNeedle, `    debugMessageEmitter.on("proxymessage", (message: string) => {
        let parsed: any = null;
        try {
            parsed = JSON.parse(message.toString());
        } catch {}

        if (parsed?.method === "Longmao.getJsContexts") {
            if (Number.isInteger(parsed.id)) {
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    id: parsed.id,
                    result: {
                        contexts: Array.from(jsContexts.entries()).map(([id, name]) => ({ id, name })),
                        activeId: activeJsContextId || null,
                    },
                }));
            }
            return;
        }

        if (parsed?.method === "Longmao.getMiniappMessages") {
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

        if (parsed?.method === "Longmao.connectJsContext") {
            const contextId = String(parsed?.params?.id ?? "");
            if (!contextId || !jsContexts.has(contextId)) {
                if (Number.isInteger(parsed.id)) {
                    debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                        id: parsed.id,
                        error: { code: -32000, message: "Unknown miniapp jscontext" },
                    }));
                }
                return;
            }

            activeJsContextId = contextId;
            const rawPayload = { jscontext_id: contextId };
            const wrappedData = codex.wrapDebugMessageData(rawPayload, "connectJsContext", 0);
            const outData = {
                seq: ++messageCounter,
                category: "connectJsContext",
                data: wrappedData.buffer,
                compressAlgo: 0,
                originalSize: wrappedData.originalSize,
            };
            const encodedData =
                messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(
                    outData,
                ).finish();
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(encodedData, { binary: true });
                }
            });
            if (Number.isInteger(parsed.id)) {
                debugMessageEmitter.emit("cdpmessage", JSON.stringify({
                    id: parsed.id,
                    result: { activeId: contextId },
                }));
            }
            return;
        }

        wss &&
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    const rawPayload = {
                        jscontext_id: activeJsContextId,
                        op_id: Math.round(100 * Math.random()),
                        payload: message.toString(),
                    };
                    logger.main_debug(rawPayload);
                    const wrappedData = codex.wrapDebugMessageData(
                        rawPayload,
                        "chromeDevtools",
                        0,
                    );
                    const outData = {
                        seq: ++messageCounter,
                        category: "chromeDevtools",
                        data: wrappedData.buffer,
                        compressAlgo: 0,
                        originalSize: wrappedData.originalSize,
                    };
                    const encodedData =
                        messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(
                            outData,
                        ).finish();
                    client.send(encodedData, { binary: true });
                }
            });
    });
`);

await writeFile(target, source, 'utf8');
console.log('Applied WMPF jscontext routing patch');
