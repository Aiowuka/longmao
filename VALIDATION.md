# 验证记录

日期：2026-09-15。分支：`exp/wmpf-totoro-integration`。

本机 Linux / Node.js v24 验证包括：

- 既有离线安全与来源测试；
- fake CDP WebSocket 的 domain enable、runtime event、畸形帧与断线重连；
- sanitizer 对 Authorization、Cookie、token、openid 等字段及 JSON 字符串的先脱敏；
- fake CDP → longmao bridge → Totoro 上游 `lib/server` → 本地 HTTP 后端完整流程；
- Totoro 原生 Next.js 进程的 `/api/login/token → /api/sunrun/tasks → /api/sunrun/start` 流程；
- Totoro 原生 HTML 代理注入、一次性启动/credential handoff、失败后的新 credential 重试，以及 dashboard 到达确认；
- 页面代理拒绝错误 Host、重复启动能力与超限请求体；仅允许两个精确 Totoro HTTPS origin 的 CDP 请求触发 handoff；
- Totoro fetch guard 保留 `Request` 的方法、查询参数和普通 headers，同时替换 Authorization 与 JSON token；
- 原生流程共收到 12 个回环请求，持久化测试记录中不含 `DEMO_SESSION`。
- `transport: native` 可以在不启动 3210 测试后端、不注入 longmao fetch guard 的情况下启动 Totoro 页面；测试不调用其业务 API。

自动化测试不包含需要临时调整 Linux ptrace 权限的真实微信/Frida 注入；这一步需在实际运行时由操作者完成。
这不会被 fake CDP 测试冒充为实机结果；需在目标 Windows 主机执行 `npm run integration:doctor` 和
`npm run integrate` 后，以 `artifacts/integration-report.json` 为准。

自动化测试中的 HTTP(S) transport 仍由 fail-closed guard 阻断或改投回环地址。`npm run integrate`
按用户要求使用 Totoro 原生 transport；验证未使用真实账号凭证、未请求学校生产 API、未提交跑步成绩。
