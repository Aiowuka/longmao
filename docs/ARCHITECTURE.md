# Longmao 架构：Sidecar Reuse

## 原则

Longmao 不复刻 Totoro 的业务实现。

凡是 Totoro 已经提供的能力，Longmao 通过 Totoro 本地 HTTP API 直接复用。

## 运行结构

```text
WeChat miniapp runtime
        │
        ▼
WMPFDebugger
  9421 remote-debug bridge
  62000 CDP proxy
        │
        ▼
Longmao CdpObserver
  ├─ Network / Runtime / Page
  ├─ allowlisted auth capture
  └─ token only in memory
        │
        ▼
Longmao TotoroClient
        │  fixed localhost HTTP API
        ▼
Totoro (separate checkout/process)
  ├─ token-login.js
  ├─ sunrun-service.js
  ├─ run-preview.js
  ├─ run-data.js
  ├─ confirmed-run.js
  ├─ start-run.js
  └─ run-queue.js
        │
        ▼
Totoro-compatible backend
```

## Longmao 允许调用的 Totoro 路径

固定白名单：

```text
/api/login/token
/api/sunrun/tasks
/api/sunrun/preview
/api/sunrun/start
/api/sunrun/run-job
```

`TotoroClient.post()` 会拒绝其他路径。

## Longmao 不再实现

以下能力由 Totoro 唯一负责：

- Token 业务验证；
- 学生身份字段映射；
- sunrun task model；
- 跑步计划生成；
- 路线 naturalization；
- GPS jitter；
- 时间戳生成；
- 设备 profile；
- getRunBegin；
- 点位查询；
- sunRunExercises；
- sunRunExercisesDetail；
- Redis 延迟队列；
- Worker 最终完成；
- Totoro 原生业务错误处理。

因此 Longmao 不包含自己的 `run-generator`、`owned-backend` 或平行生产 contract。

## 信任边界

### Longmao Web

- 只绑定 `127.0.0.1`。
- Host header 仅允许 localhost / 127.0.0.1。
- CSP 禁止外部脚本和 iframe。

### Totoro sidecar

- `baseUrl` 必须是 loopback origin。
- Longmao 不启动、不修改、不打包 Totoro。
- Totoro 的业务后台配置继续由 Totoro 自己的环境变量管理。

### CDP

- WMPFDebugger 仍作为独立 sidecar。
- Longmao 只连接 loopback CDP。
- 只有配置 capture origin 的请求可能触发 Token 捕获。
- Token 不落盘，也不通过 API 返回明文。

## 兼容性 snapshot

当前 Longmao adapter 按以下 Totoro snapshot 核对：

```text
c499040d52c6e1d45f06f7949419799ccc770db9
```

如果 Totoro 后续修改上述五个 API 的 payload 或响应结构，应先更新 adapter contract tests，再升级 snapshot。
