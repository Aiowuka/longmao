# 上游固定与集成验证

日期：2026-09-15。`upstreams.lock.json` 固定：

- `yuyuyudlc/Totoro` — `5b3199f864e114f4981403d05c94160ebdd730ab`
- `evi0s/WMPFDebugger` — `e65e3ec98ea38de8ea78fc0ad02d01d9b2fd0345`

`npm run integration:doctor` 对相邻 Git checkout 执行 `git rev-parse HEAD` 并逐项报告
`expected`、`actual` 与 `matches`；真实入口遇到不匹配会返回 `UPSTREAM_COMMIT_MISMATCH`。

Totoro 根目录没有发现许可证文件，当前标记为未确认，不复制或重新分发其源码。WMPFDebugger
上游声明 GPL-2.0-only，并另外提示 `src/third-party` 的腾讯版权；longmao 只从独立 checkout
启动进程，不 vendor 这些文件。详细说明见 `THIRD_PARTY_NOTICES.md`。

`integrated: true` 表示本机运行时依赖已建立，不表示上游作者参与、背书或授予了额外许可。
