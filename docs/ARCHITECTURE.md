# Longmao Local Web 架构

## 目标

在一个本机网页里统一展示两类能力：

1. **Totoro 风格的分阶段流程实验**：继续使用本仓库独立编写的内存 Mock，不连接生产后端。
2. **WMPFDebugger 状态桥**：只检查 WMPFDebugger 默认的两个 loopback WebSocket 端口是否监听，不读取 WebSocket 消息。

## 结构

```text
Browser
  │  http://127.0.0.1:3210
  ▼
src/web.mjs
  ├─ /api/mock/run ───────► src/lab.mjs ─────► in-memory mock
  ├─ /api/report ─────────► artifacts/last-report.json
  ├─ /api/sources ────────► upstreams.lock.json
  └─ /api/wmpf ───────────► src/wmpf-bridge.mjs
                               ├─ TCP probe 127.0.0.1:9421
                               └─ TCP probe 127.0.0.1:62000
```

WMPFDebugger 上游当前默认使用 9421 作为 remote-debug bridge、62000 作为 CDP proxy。Longmao 不复制或启动其代码，只把这两个端口当作 sidecar readiness signal。

## 明确不做

- 不读取、记录或导出 WMPF WebSocket 消息。
- 不捕获 Cookie、Authorization、Token 或微信登录凭据。
- 不生成/修改真实运动轨迹。
- 不重放生产请求。
- 不提供学校后端地址配置。
- 不提供真实成绩提交 API。
- Web 服务不允许绑定 `0.0.0.0`，只监听 `127.0.0.1`。

如果后续扩展调试能力，应继续把“观察/诊断”和“生产写入”拆成两个不同的适配层，并让生产写入默认不存在。
