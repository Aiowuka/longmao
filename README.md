# longmao — WMPF + Totoro 本地编排器

Longmao 不重复实现 Totoro 的跑步业务逻辑，而是把 **WMPFDebugger + Totoro + 本地 Web 控制台** 编排成一个可安装、可启动、可诊断的本地工具。

```text
微信小程序
   ↓
WMPFDebugger
   ↓  ws://127.0.0.1:62000
Longmao CDP Observer
   ↓  捕获 Token（仅内存）
Totoro HTTP Sidecar
   ↓
你的 Totoro-compatible 后台
```

## Windows 普通用户：直接装 EXE

优先使用 Actions / Release 生成的：

```text
LongmaoSetup-0.5.0-win-x64.exe
```

安装器本身 **只包含 Longmao 自己的代码**。首次安装会在用户机器上：

1. 检查 Node.js 22+、Git 和 Redis-compatible 服务；
2. 缺少时通过 Windows Package Manager 安装 Node/Git/Memurai Developer；
3. 从各自官方 GitHub 仓库拉取固定 commit 的 Totoro 和 WMPFDebugger；
4. 安装上游依赖；
5. 询问一次你的后台 HTTPS origin；
6. 构建 Totoro；
7. 创建桌面与开始菜单快捷方式；
8. 启动完整本地栈并打开 Longmao 页面。

Totoro 和 WMPFDebugger 不被复制进 Longmao 仓库，也不被打进 Longmao 安装包。

如果直接从源码使用，也可以双击：

```text
Install Longmao.cmd
```


## Linux 普通用户：直接运行 .run

使用 Actions / Release 生成的：

```text
LongmaoSetup-0.5.0-linux-x64.run
```

安装：

```bash
chmod +x LongmaoSetup-0.5.0-linux-x64.run
./LongmaoSetup-0.5.0-linux-x64.run
```

当前完整 Linux 一键安装器支持 x86_64，并自动处理 Debian/Ubuntu、Fedora/RHEL、Arch 三类常见发行版。

它会：

1. 检查 Git/curl/xz/Python/编译工具/redis-server；
2. 缺失时通过 apt/dnf/pacman 安装；
3. 如果系统 Node <22，从 nodejs.org 下载官方 `latest-v22.x` Linux x64 runtime，并校验官方 SHA-256；
4. 从上游 GitHub 拉取 pinned Totoro/WMPFDebugger；
5. 安装依赖、配置后台、build Totoro；
6. 创建统一的 `longmao <command>` CLI，并保留旧命令作为兼容别名；
7. 自动启动完整本地栈。

完整卸载：

```bash
longmao uninstall
```

保留配置卸载：

```bash
longmao uninstall --keep-config
```

Linux 安装后统一使用：

```bash
longmao start
longmao stop
longmao restart
longmao status
longmao configure
longmao repair
longmao logs
longmao open
longmao version
longmao uninstall
```

Linux 用户手册见 [docs/LINUX_USER_GUIDE.md](docs/LINUX_USER_GUIDE.md)。

## 每次使用

以后通常只需要：

```text
双击桌面 Longmao
   ↓
打开微信和目标小程序
   ↓
Longmao 页面点“连接 CDP”
   ↓
正常登录/刷新小程序
   ↓
看到脱敏 Token
   ↓
点“用捕获 Token 同步 Totoro”
   ↓
选择任务 / 路线
   ↓
生成 Totoro Preview
   ↓
确认后交给 Totoro 开始
   ↓
查看 Queue / Worker / 最终结果
```

完整用户手册见 [docs/USER_GUIDE.md](docs/USER_GUIDE.md)。

## 本地运行栈

统一启动器管理：

| 服务 | 地址/端口 | 作用 |
| --- | --- | --- |
| Memurai / Redis-compatible | `127.0.0.1:6379` | Totoro BullMQ |
| Totoro Web | `127.0.0.1:3000` | Totoro 原生业务 API |
| Totoro Worker | local process | 延迟队列执行 |
| WMPFDebugger | `127.0.0.1:9421` | remote-debug bridge |
| WMPF CDP | `127.0.0.1:62000` | Chrome DevTools Protocol |
| Longmao | `127.0.0.1:3210` | 用户控制台 |

Windows Runtime：

```text
%LOCALAPPDATA%\LongmaoRuntime
```

Linux：

```text
~/.local/opt/longmao          # Longmao 程序
~/.local/share/longmao        # upstreams / node / redis / logs / pids
~/.config/longmao             # 配置
```

运行数据与程序安装目录分离。

## 快捷方式

安装后提供：

- **Longmao**：启动完整本地栈并打开浏览器；
- **Longmao Stop**：停止 Longmao、Totoro、Worker、WMPF；
- **Longmao Status**：检查五个本地端口；
- **Longmao Configure**：修改自有后台 origin；
- **Longmao Repair**：重新核对 pinned upstream、安装依赖、重建 Totoro。

## Totoro 复用

当前 Longmao adapter 按以下 Totoro snapshot 验证：

```text
yuyuyudlc/Totoro
c499040d52c6e1d45f06f7949419799ccc770db9
```

Longmao 只调用 Totoro 已有 API：

- `POST /api/login/token`
- `POST /api/sunrun/tasks`
- `POST /api/sunrun/preview`
- `POST /api/sunrun/start`
- `POST /api/sunrun/run-job`

Longmao 不生成业务路线、不生成跑步轨迹、不重新实现 Totoro 的提交格式和 Worker。

## WMPFDebugger 复用

当前核对：

```text
evi0s/WMPFDebugger
8b1359fa282981a777eea72a4851a3e96674fa9c
```

WMPFDebugger 仍作为独立 sidecar 运行。Longmao 只连接其 loopback CDP proxy，不复制 Frida/hook/protobuf 实现。

## Token 边界

- 只有配置的 `capture.origin` 完全匹配时才观察对应 Network 事件；
- 只有配置 pathname prefix 才尝试提取 Token；
- 原始 Token 只存在 Longmao Node 进程内存中；
- Web 只显示脱敏预览；
- 不写入 Git、配置文件或 artifacts。

## Windows Redis-compatible 服务

Windows 一键安装默认使用 Memurai Developer 作为本地 Redis-compatible 服务。

它由安装器通过 Windows Package Manager 从 Memurai 自己的渠道安装，不随 Longmao 重新分发。Developer Edition 适合本地开发/测试，不应当作生产授权使用。

如果机器已经有兼容 Redis 并监听 `127.0.0.1:6379`，安装器会直接复用，不强制安装 Memurai。

## 手动开发方式

需要 Node.js 22+。

配置 Longmao：

```powershell
Copy-Item config/totoro.example.json config/totoro.json
```

手动启动 Longmao：

```sh
npm run web
```

浏览器：

```text
http://127.0.0.1:3210
```

Totoro 与 WMPF 的手动安装见 [docs/SIDECAR_SETUP.md](docs/SIDECAR_SETUP.md)。

## 验证

```sh
npm run doctor
npm test
npm run demo
npm run reproduce
npm run sources
```

当前 CI 覆盖：

- Ubuntu / Node 22
- Ubuntu / Node 24
- Windows / Node 22
- Windows / Node 24
- Windows PowerShell installer script parse
- Inno Setup EXE build
- Linux bash syntax / shellcheck
- Makeself .run build + archive content inspection

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/cdp-observer.mjs` | WMPF CDP 观察与 allowlisted Token 捕获 |
| `src/totoro-config.mjs` | Totoro sidecar / capture 配置 |
| `src/totoro-client.mjs` | Totoro 原生 HTTP API adapter |
| `src/web.mjs` | Longmao 本地编排 API |
| `scripts/windows/` | Windows 一键安装、启动、停止、修复、状态脚本 |
| `installer/windows/` | Inno Setup Windows 安装包定义 |
| `scripts/linux/` | Linux 安装、启动、停止、状态、修复、卸载脚本 |
| `installer/linux/` | Makeself Linux `.run` 安装包定义 |
| `docs/USER_GUIDE.md` | Windows 普通用户使用手册 |
| `docs/LINUX_USER_GUIDE.md` | Linux 普通用户使用手册 |
| `upstreams.lock.json` | 当前核对的 Totoro / WMPF snapshots |

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
