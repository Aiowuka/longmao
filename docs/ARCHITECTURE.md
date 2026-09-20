# Longmao 架构

## 当前目标

Longmao 是本机控制台。它把 WMPFDebugger 暴露的 CDP 代理、自有后台登录态和一个固定的测试跑步 contract 串起来，同时保留离线 Mock 作为回归基线。

```text
WeChat miniapp runtime
        │
        ▼
WMPFDebugger
  9421 remote-debug bridge
  62000 CDP proxy
        │
        ▼
CdpObserver
  ├─ Network / Runtime / Page
  ├─ 只保留 backend.json.origin 的 Network 摘要
  └─ Token 只驻留 Node 进程内存
        │
        ▼
SelfHostedBackend
  profile? → tasks? → start → submit → receipt?
        ▲
        │
Synthetic Run Generator
        │
        ▼
Longmao Web
http://127.0.0.1:3210
```

## 信任边界

### Web

- 固定绑定 `127.0.0.1`。
- Host header 仅接受 localhost / 127.0.0.1。
- CSP 禁止外部脚本和 iframe。

### CDP

- 只连接 `ws://127.0.0.1:62000`。
- Network 时间线只记录配置 origin 的 path / method / status。
- Console 只记录 level 和参数数量，不保存参数值。
- Token 只从配置 origin + capture path 上捕获。
- 原始 Token 不通过 Web API 返回，不落盘。

### 自有后台

- 远程 origin 必须 HTTPS；loopback 可使用 HTTP。
- 端点必须是相对 path，只支持 GET / POST。
- 不存在“任意 URL / Header / Body”重放 API。
- 运行数据明确携带 `synthetic: true`。
- 自有后台运行报告仅驻留内存；原离线 Mock 报告继续写入 `artifacts/last-report.json`。

## 状态机

```text
connect_cdp
  ↓
capture_owned_backend_auth
  ↓
profile (optional)
  ↓
tasks (optional)
  ↓
generate_synthetic_run
  ↓
start
  ↓
submit
  ↓
receipt (optional)
```

自有后台接入字段与示例见 [SELF_HOSTED_BACKEND.md](SELF_HOSTED_BACKEND.md)。
