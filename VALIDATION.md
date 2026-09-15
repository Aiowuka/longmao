# 验证记录

日期：2026-09-15。执行环境：Linux，Node.js v22.16.0，npm 10.9.2。

执行命令：`npm run reproduce`。

```text
tests 31
pass 31
fail 0
cancelled 0
skipped 0
```

成功场景六个阶段全部完成，输出 `mode: offline-mock`、`ok: true`。
`expired-session` 与 `rejected-submission` 场景的 CLI 返回码均为 1，报告状态与错误码均通过测试。

这些结果仅证明独立本地模拟、输入检查、幂等和命令行行为通过测试。
未运行微信、WMPFDebugger 或 Totoro；未抓取任何登录凭据；未访问真实业务后端。
Windows 启动脚本未在本次 Linux 环境执行；跨平台结果应以该提交对应的 GitHub Actions 为准。
此记录不预先宣称 CI 已通过。
