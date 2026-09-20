# Sidecar 复用验证

日期：2026-09-20。

## 架构结论

Longmao 不再实现 Totoro 已有的业务能力。

真实主链为：

```text
WMPFDebugger (external sidecar)
  -> Longmao CDP observer
  -> Totoro (external sidecar)
  -> Totoro-compatible backend
```

删除的平行实现：

- `src/backend-config.mjs`
- `src/owned-backend.mjs`
- `src/run-generator.mjs`
- `config/backend.example.json`
- `docs/SELF_HOSTED_BACKEND.md`

## Totoro contract

当前 adapter 按 `yuyuyudlc/Totoro@c499040d52c6e1d45f06f7949419799ccc770db9` 核对以下原生 API：

- `POST /api/login/token`
- `POST /api/sunrun/tasks`
- `POST /api/sunrun/preview`
- `POST /api/sunrun/start`
- `POST /api/sunrun/run-job`

测试会校验实际路径与 payload 字段，并确认 Longmao 不暴露任意 upstream path。

## WMPF contract

当前按 `evi0s/WMPFDebugger@8b1359fa282981a777eea72a4851a3e96674fa9c` 的 loopback CDP proxy 互操作。

Longmao 不复制或启动 WMPFDebugger。

## 凭据

- 只对配置的 capture origin 捕获。
- Token 只在 Longmao 进程内存。
- TotoroClient 的公开 state 会移除 profile 中可能返回的 token。
- Web UI 不提供 Token 输入框和明文 Token API。
