# 方法参考、来源与许可状态

核对日期：2026-09-20。这里记录思想参考与互操作关系，不表示上游作者参与、背书或授权 Longmao 的独立代码。

## Totoro Sunrun — yuyuyudlc 与其贡献者

- 原仓库：https://github.com/yuyuyudlc/Totoro
- 本次核对版本：`c499040d52c6e1d45f06f7949419799ccc770db9`
- 参考内容：客户端/服务端分层，以及 profile、任务、场次、提交、回执等分阶段流程。
- Longmao 处理方式：**reference-only**。自有后台 contract、CDP 观察器、测试数据生成器均为独立实现，不复制 Totoro 的生产接口代码或请求契约。
- 许可状态：已核对材料中未确认明确项目许可证；这不是对全仓每个文件的法律审查。

## WMPFDebugger — evi0s 与其贡献者

- 原仓库：https://github.com/evi0s/WMPFDebugger
- 本次核对版本：`8b1359fa282981a777eea72a4851a3e96674fa9c`
- 上游许可证：GNU GPL v2.0；上游另说明 `src/third-party` 含第三方版权代码。
- Longmao 处理方式：**optional-sidecar-cdp**。
  - WMPFDebugger 由用户独立安装、启动和更新。
  - Longmao 不复制、修改、打包或分发 WMPFDebugger 源码/二进制。
  - Longmao 作为外部客户端连接其 loopback CDP proxy（默认 `ws://127.0.0.1:62000`）。
  - Longmao 不调用 Frida API，也不包含 WMPF hook / protobuf / third-party 代码。
- 若未来把 WMPFDebugger 代码复制、修改或随 Longmao 一起分发，需要重新审查 GPLv2 与第三方版权义务；单独署名不能替代许可证要求。

## 本仓库

Longmao 当前为私有仓库，`package.json` 标记为 `private: true` 与 `UNLICENSED`。这不会改变任何上游项目的权利。

`upstreams.lock.json` 固定本次检查过的上游快照与互操作状态，不是 npm 依赖锁文件。
