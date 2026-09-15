# 验证记录

日期：2026-09-15。分支：`exp/wmpf-totoro-integration`。

本机 Linux / Node.js v24 验证包括：

- 既有离线安全与来源测试；
- fake CDP WebSocket 的 domain enable、runtime event、畸形帧与断线重连；
- sanitizer 对 Authorization、Cookie、token、openid 等字段及 JSON 字符串的先脱敏；
- fake CDP → longmao bridge → Totoro 上游 `lib/server` → 本地 HTTP 后端完整流程；
- Totoro 原生 Next.js 进程的 `/api/login/token → /api/sunrun/tasks → /api/sunrun/start` 流程；
- 原生流程共收到 12 个回环请求，持久化测试记录中不含 `DEMO_SESSION`。

未在本机完成的唯一真实前置是 PC 微信进程和 Frida/WMPF 注入，因为当前验证主机不是 Windows 微信环境。
这不会被 fake CDP 测试冒充为实机结果；需在目标 Windows 主机执行 `npm run integration:doctor` 和
`npm run integrate` 后，以 `artifacts/integration-report.json` 为准。

所有生产 HTTP(S) transport 均由 fail-closed guard 阻断或改投回环地址。验证未使用真实账号凭证，
未请求学校生产 API，未提交跑步成绩。
