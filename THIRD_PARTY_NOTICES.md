# 方法参考、来源与许可状态

核对日期：2026-09-20。

Longmao 当前采用 **sidecar interoperability**：上游项目由用户单独获取、安装、运行和更新；Longmao 不把它们的源码或二进制复制进本仓库。

## Totoro Sunrun — yuyuyudlc 与其贡献者

- 仓库：https://github.com/yuyuyudlc/Totoro
- Longmao 当前核对 snapshot：`c499040d52c6e1d45f06f7949419799ccc770db9`
- 集成方式：`optional-sidecar-http`
- Longmao 调用的固定 API：
  - `/api/login/token`
  - `/api/sunrun/tasks`
  - `/api/sunrun/preview`
  - `/api/sunrun/start`
  - `/api/sunrun/run-job`
- Totoro 自己负责 Token 验证、任务模型、Preview、run-data、start-run、Redis queue、Worker 和业务后台请求。
- Longmao 不复制上述实现，也不再维护平行业务实现。
- 许可状态：在当前核对材料中仍未确认明确项目级许可证。因此不把 Totoro 代码 vendoring、复制或重新分发到 Longmao；这里只做本机进程间 HTTP 互操作。

## WMPFDebugger — evi0s 与其贡献者

- 仓库：https://github.com/evi0s/WMPFDebugger
- Longmao 当前核对 snapshot：`8b1359fa282981a777eea72a4851a3e96674fa9c`
- 上游许可证：GNU GPL v2.0；上游另说明 `src/third-party` 含第三方版权代码。
- 集成方式：`optional-sidecar-cdp`
- Longmao 仅连接其 loopback CDP proxy，不复制 hook、Frida、protobuf、third-party 源码或二进制。

## Longmao

Longmao 自己的仓库目前标记 `private: true` / `UNLICENSED`。这不改变任何上游权利。

`upstreams.lock.json` 记录 Longmao adapter 当前核对过的上游 snapshot 和互操作方式，不是 npm dependency lockfile。
