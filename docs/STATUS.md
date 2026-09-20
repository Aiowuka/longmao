# Longmao 0.5 Beta — 收口状态

更新日期：2026-09-20

## 当前结论

Longmao 已完成工程收口，当前阶段冻结新增功能。

已经稳定的部分：
- Windows / Linux 本地安装与启动链路；
- `longmao <command>` CLI、状态、日志、修复、卸载；
- WMPFDebugger / Totoro sidecar 编排；
- 本地 Web 控制台；
- loopback / Host / CSP 等本地安全边界；
- Windows / Ubuntu × Node.js 22 / 24 离线 CI；
- NETWORK_ONLY / FULL_RUNTIME 能力探测；
- 脱敏诊断事件。

尚未完成的 P0：
- 在部分真实 Linux 微信 / WMPF 环境中，CDP 虽可连接并启用 Network / Runtime / Page，但无法获得可用的 AppService JSContext；
- 因此登录态读取不能视为稳定能力；
- `auth_storage_retry` 反复出现时不得继续把该环境标记为“可用”。

## 冻结规则

在 P0 关闭之前：
1. 不新增业务功能；
2. 不新增新的并行 backend / run generator；
3. 不把 Token 获取写成已完成能力；
4. 不因为 CI 全绿就宣称真实端到端链路通过；
5. NETWORK_ONLY 模式只做脱敏网络元数据诊断；
6. 真实系统行为仅允许在明确授权的测试环境中验证。

## 唯一后续主线

```text
WMPF / CDP capability detection
        ↓
确认是否存在真实 AppService JSContext
        ↓
若不存在 → NETWORK_ONLY，停止登录态轮询
        ↓
若存在 → 验证 Runtime.evaluate 路由
        ↓
仅在授权测试环境验证登录态读取
```

完成标准不是“日志更少”，而是：
- 能稳定区分 NETWORK_ONLY 与 FULL_RUNTIME；
- NETWORK_ONLY 不再出现无意义的 auth retry；
- FULL_RUNTIME 下 AppService context 可被重复发现；
- 对应自动化回归测试通过；
- 至少一次明确记录的授权环境人工验证通过。

## 分支策略

- `main`：唯一权威、可安装、可测试版本；
- `archive/main-pre-consolidation-20260920`：收口前旧 main 的只读备份；
- 旧的 stacked feature PR 全部视为历史实现记录，不再作为发布入口。

## 当前发布定位

Longmao 0.5 Beta 是一个 **本地编排与诊断工具**。

它不是“真实链路已经稳定跑通”的正式版。
