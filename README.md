# longmao — WMPFDebugger × Totoro 本机集成实验

本分支把两个固定版本的上游源码作为**相邻 Git checkout** 实际运行：

```text
PC 微信 → WMPFDebugger → CDP WebSocket → sanitizer → longmao bridge
       → 一次性内存 credential handoff → Totoro 原生页面 / dashboard
       → Totoro 原生 Next.js API / lib/server → Totoro 原有业务流程
```

Totoro 不是 longmao 重写的 mock。`npm run integrate` 自动阶段只启动 Totoro 自己的 Next.js
服务、提交检测到的 token 并进入 dashboard；之后是否调用 `/api/sunrun/tasks`、
`/api/sunrun/start` 等接口，取决于用户在 Totoro 原生页面上的操作。自动化测试还会直接 import
其 `lib/server` 模块，并在隔离的本地 transport 下覆盖这些 API。两个上游均不复制进本仓库，固定 commit 和许可状态见
`upstreams.lock.json` 与 `THIRD_PARTY_NOTICES.md`。

## 安全边界

- 仅从两个固定 Totoro HTTPS origin 的 CDP 网络请求中识别 Token；longmao 不打印、不写报告，只通过受保护的本地内存 handoff 交给 Totoro。
- Runtime 事件在进入日志、状态和报告前递归脱敏；报告只记录 `credentialPresent` 布尔值。
- 页面代理只监听 loopback，并用一次性启动能力、HttpOnly 同站会话、精确 Host/Origin 校验防止其他网页读取 handoff。
- handoff 完成后不改写 Totoro 的登录存储、Cookie 或业务状态；是否保存登录态由原生 Totoro 自己决定。
- `npm run integrate` 不改写 Totoro transport；完成 token handoff 后，网络行为与相邻 Totoro checkout 单独启动时一致。
- Totoro 默认业务 origin 是 `https://wxxcx.xtotoro.com`；在 Totoro 页面执行操作会调用其原有接口。
- 不修改微信、系统代理或注册表，不终止微信进程，不设置开机启动。
- longmao 不自动点击 Totoro 的业务操作，也不实现定位、人脸、摄像头或设备检查绕过。

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

先启动并登录 PC 微信，然后运行：

```bash
npm run integration:doctor
npm run integrate
```

若 `127.0.0.1:62000` 未监听，`integrate` 会从相邻 checkout 启动真实 WMPFDebugger；
它不会用 MockWmpfRuntime 代替。随后会自动打开 `http://127.0.0.1:3211`，这里是注入了
一次性 handoff 的 Totoro 原生页面代理；Totoro 自身仍运行在内部的 `127.0.0.1:3220`。
打开并登录目标微信小程序后，页面会自动提交检测到的会话并进入 `/dashboard`。
Windows 可双击 `start-integration.cmd`，脚本只检查依赖、微信进程与相邻 checkout，然后打开集成日志窗口。

Totoro 原接口配置保持无路径 HTTPS origin：`SUNRUN_MINIPROGRAM_BASE_URL=https://wxxcx.xtotoro.com`。
集成入口不会覆盖该配置或注入 transport guard；token 交接完成后由 Totoro 自己处理后续请求。

成功 handoff 后生成权限为仅当前用户可读写的 `artifacts/integration-report.json`；命令保持运行，
让 dashboard 可继续操作，按 Ctrl+C 才清理全部本地进程。旧的完全离线实验仍保留：

```bash
npm run reproduce
npm run demo
```

## 验证

```bash
npm test
```

测试覆盖 CDP server 缺失/连接、畸形帧、断线重连与事件，深层 credential 脱敏，测试 transport 的
外部 URL 拒绝、真实 Totoro 模块加载，以及 fake CDP → bridge → 真实 Totoro 模块 → 本地 HTTP
的端到端链路。测试仍使用显式的 `transport: local`，不会请求生产接口；`integrate` 使用
`transport: native`。如果相邻 Totoro 已安装依赖，还会启动它的原生 Next.js 服务验证两种模式。

Linux 自动化测试不能替代 Windows 上真实微信/WMPF 注入验证；`integration:doctor` 会明确显示该差异。
Linux 上若 `/proc/sys/kernel/yama/ptrace_scope` 阻止 Frida attach，doctor 会报告
`fridaAttachLikelyAllowed: false`，真实入口会以 `FRIDA_ATTACH_BLOCKED_BY_PTRACE_SCOPE` 快速失败；
longmao 不会自行修改该系统策略或重启微信来规避它。
