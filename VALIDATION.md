# 验证记录

日期：2026-09-20。

目标提交（业务重构）：`97cbc839737ee56fb83bec098ccf566a388b4983`

GitHub Actions：

```text
https://github.com/Aiowuka/longmao/actions/runs/35502793537
```

矩阵结果：

```text
Ubuntu  / Node 22  success
Ubuntu  / Node 24  success
Windows / Node 22  success
Windows / Node 24  success
```

其中 Ubuntu / Node 22 的 `npm test`：

```text
tests 51
pass 51
fail 0
```

随后 `npm run demo` 成功完成离线 Mock 六阶段流程。

## 本次验证覆盖

- Longmao 原离线 Mock 回归。
- 来源/sidecar integration metadata。
- Web loopback-only 绑定与 CSP。
- Totoro 未配置时 fail closed。
- Totoro base URL 必须为 loopback。
- CDP 只从配置 capture origin 捕获 Token。
- Totoro adapter 固定调用原生 API：
  - `/api/login/token`
  - `/api/sunrun/tasks`
  - `/api/sunrun/preview`
  - `/api/sunrun/start`
  - `/api/sunrun/run-job`
- Totoro 原生 payload contract。
- Longmao 不提供 arbitrary upstream path。
- Totoro 返回 profile 中即使带 token，Longmao public state 也不会返回该字段。
- Linux / Windows 跨平台 Node 22 / 24。

## 尚未覆盖

CI 没有启动真实微信、WMPFDebugger、Redis、Totoro dev server 或用户自有后台。

因此当前结论是：

**Longmao 的 sidecar adapter、边界与 contract tests 已通过；真实 WMPF + Totoro + 用户后台仍需要在用户电脑做一次实机联调。**
