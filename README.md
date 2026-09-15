# longmao — WMPFDebugger × Totoro 本机集成实验

本分支把两个固定版本的上游源码作为**相邻 Git checkout** 实际运行：

```text
PC 微信 → WMPFDebugger → CDP WebSocket → sanitizer → longmao bridge
       → Totoro 原生 Next.js API / lib/server → loopback contract backend → 报告
```

Totoro 不是 longmao 重写的 mock。默认路径启动 Totoro 自己的 Next.js 后端，再调用其
`/api/login/token`、`/api/sunrun/tasks` 和 `/api/sunrun/start`；自动化测试还会直接 import
其 `lib/server` 模块。两个上游均不复制进本仓库，固定 commit 和许可状态见
`upstreams.lock.json` 与 `THIRD_PARTY_NOTICES.md`。

## 安全边界

- 不获取、保存或打印真实 Token、Cookie、openid、unionid 或 Authorization。
- Runtime 事件在进入日志、状态和报告前递归脱敏；报告只记录 `credentialPresent` 布尔值。
- Totoro 始终使用 `DEMO_SESSION`，本地合约后端只接受该 synthetic credential。
- Totoro 子进程安装 fail-closed fetch guard：已知 Totoro 上游请求被改投 `127.0.0.1`，其他外部 HTTP(S) 请求返回 `EXTERNAL_BACKEND_BLOCKED`。
- 不修改微信、系统代理或注册表，不终止微信进程，不设置开机启动。
- 这只是本机集成实验，不提交学校生产成绩，也不绕过定位、人脸、摄像头或设备检查。

## 目录布局与安装

```text
workspace/
├── longmao/       # exp/wmpf-totoro-integration
├── Totoro/        # 5b3199f864e114f4981403d05c94160ebdd730ab
└── WMPFDebugger/  # e65e3ec98ea38de8ea78fc0ad02d01d9b2fd0345
```

```bash
git clone https://github.com/yuyuyudlc/Totoro ../Totoro
git -C ../Totoro checkout 5b3199f864e114f4981403d05c94160ebdd730ab
git clone https://github.com/evi0s/WMPFDebugger ../WMPFDebugger
git -C ../WMPFDebugger checkout e65e3ec98ea38de8ea78fc0ad02d01d9b2fd0345
npm install
corepack pnpm --dir ../Totoro install --frozen-lockfile --ignore-scripts
yarn --cwd ../WMPFDebugger
```

需要 Node.js 22+。真实运行还需要受 WMPFDebugger 当前版本支持的 PC 微信与系统环境。

## 运行

先启动 PC 微信并打开目标小程序，然后运行：

```bash
npm run integration:doctor
npm run integrate
```

若 `127.0.0.1:62000` 未监听，`integrate` 会从相邻 checkout 启动真实 WMPFDebugger；
它不会用 MockWmpfRuntime 代替。Windows 可双击 `start-integration.cmd`，脚本只检查依赖、
微信进程与相邻 checkout，然后打开集成日志窗口。

成功时生成权限为仅当前用户可读写的 `artifacts/integration-report.json`。旧的完全离线实验仍保留：

```bash
npm run reproduce
npm run demo
```

## 验证

```bash
npm test
```

测试覆盖 CDP server 缺失/连接、畸形帧、断线重连与事件，深层 credential 脱敏，外部 URL 拒绝，
真实 Totoro 模块加载，错误 transport，以及 fake CDP → bridge → 真实 Totoro 模块 → 本地 HTTP
的端到端链路。如果相邻 Totoro 已安装依赖，还会启动它的原生 Next.js 后端并执行三条真实 API route。

Linux 自动化测试不能替代 Windows 上真实微信/WMPF 注入验证；`integration:doctor` 会明确显示该差异。
Linux 上若 `/proc/sys/kernel/yama/ptrace_scope` 阻止 Frida attach，doctor 会报告
`fridaAttachLikelyAllowed: false`，真实入口会以 `FRIDA_ATTACH_BLOCKED_BY_PTRACE_SCOPE` 快速失败；
longmao 不会自行修改该系统策略或重启微信来规避它。
