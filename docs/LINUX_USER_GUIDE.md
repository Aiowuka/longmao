# Longmao Linux 用户手册

## 支持范围

当前完整 Linux 一键安装器支持：

- x86_64 Linux；
- Debian / Ubuntu 系；
- Fedora / RHEL 系；
- Arch Linux 系。

WMPFDebugger 上游目前的 Linux 支持也是 x86_64，因此 ARM64 Linux 暂不作为完整栈支持目标。

## 安装

下载：

```text
LongmaoSetup-0.5.0-linux-x64.run
```

然后：

```bash
chmod +x LongmaoSetup-0.5.0-linux-x64.run
./LongmaoSetup-0.5.0-linux-x64.run
```

安装器本身只包含 Longmao 自有代码。

首次安装会：

1. 检查 x86_64；
2. 检查 Git、curl、xz、Python、编译工具和 redis-server；
3. 缺少系统依赖时通过 apt / dnf / pacman 安装；
4. 检查 Node.js >= 22；
5. 如果系统 Node 太旧，直接从 nodejs.org 的 `latest-v22.x` 下载官方 Linux x64 二进制，并根据官方 `SHASUMS256.txt` 校验 SHA-256；
6. 从各自官方 GitHub 拉取 pinned Totoro 与 WMPFDebugger；
7. 安装上游依赖；
8. 询问一次你的 Totoro-compatible 后台 HTTPS origin；
9. 构建 Totoro；
10. 创建 `longmao` 等用户命令与桌面入口；
11. 自动启动完整本地栈。

Longmao 不会把 Totoro 或 WMPFDebugger 源码预先打包进安装器。

## 安装位置

程序：

```text
~/.local/opt/longmao
```

运行时：

```text
~/.local/share/longmao
├── upstreams/
│   ├── Totoro/
│   └── WMPFDebugger/
├── node/          # 仅系统 Node <22 时存在
├── redis/
├── logs/
├── pids/
└── runtime.json
```

配置：

```text
~/.config/longmao/totoro.json
```

命令：

```text
~/.local/bin/longmao
# 旧版 longmao-stop 等兼容 wrapper 仍会保留
```

如果 `~/.local/bin` 还没在 PATH，重新登录桌面会话通常会生效；也可以直接运行：

```bash
~/.local/bin/longmao
```

## CLI

安装后统一使用一个命令：

```bash
longmao help
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

旧的 `longmao-stop`、`longmao-status` 等命令仍作为兼容别名保留，但新文档统一使用 `longmao <command>`。

## 每次使用

运行：

```bash
longmao start
```

启动器会依次检查/启动：

```text
Redis              127.0.0.1:6379
Totoro Web         127.0.0.1:3000
Totoro Worker      local process
WMPFDebugger       127.0.0.1:9421 / 62000
Longmao Web        127.0.0.1:3210
```

如果系统已经有 Redis 在 `127.0.0.1:6379`，Longmao 直接复用；否则启动自己管理的 `redis-server` 进程。

随后：

```text
打开 Linux 微信
    ↓
打开连接到自有后台的小程序
    ↓
Longmao 页面点击“连接 CDP”
    ↓
正常登录 / 刷新
    ↓
看到脱敏 Token
    ↓
同步 Totoro
    ↓
选择任务和路线
    ↓
生成 Totoro Preview
    ↓
确认后交给 Totoro 开始
    ↓
查看 Queue / Worker / 最终结果
```

浏览器默认打开：

```text
http://127.0.0.1:3210
```

## 状态

```bash
longmao status
```

例如：

```text
UP    Redis         127.0.0.1:6379
UP    Totoro        127.0.0.1:3000
UP    Longmao       127.0.0.1:3210
UP    WMPF-debug    127.0.0.1:9421
UP    WMPF-CDP      127.0.0.1:62000
```

## 停止

```bash
longmao stop
```

只停止 Longmao 自己记录并管理的进程。

如果 `6379` 原本就是系统已有 Redis，Longmao 不会关闭它。

## 修改后台

```bash
longmao configure
longmao stop
longmao
```

## 修复

```bash
longmao repair
```

会重新：

- checkout pinned Totoro；
- checkout pinned WMPFDebugger；
- 安装依赖；
- build Totoro；
- 重新写入已有后台配置。

## 完整卸载

运行：

```bash
longmao uninstall
```

它会明确询问一次，然后删除：

- `~/.local/opt/longmao`；
- Longmao 拉取的 Totoro；
- Longmao 拉取的 WMPFDebugger；
- Longmao 私有 Node runtime；
- Longmao logs / pids / runtime；
- Longmao 配置；
- Longmao 的 `~/.local/bin` 命令；
- Longmao 的桌面入口。

### 保留配置卸载

```bash
longmao uninstall --keep-config
```

会保留：

```text
~/.config/longmao
```

### 自动确认

```bash
longmao uninstall --yes
```

用于脚本化卸载。

## 卸载不会做什么

Longmao **不会**自动卸载系统级的：

- Git；
- curl；
- Python；
- 编译工具；
- redis-server；
- 微信。

原因是这些包可能被其他程序使用。

如果安装时系统缺 Redis，安装器可能通过 apt/dnf/pacman 安装了它；Longmao 卸载仍然不会自动删除这个系统包。

## 日志

```text
~/.local/share/longmao/logs/
```

包括：

```text
redis.out.log
redis.err.log
totoro-web.out.log
totoro-web.err.log
totoro-worker.out.log
totoro-worker.err.log
wmpf-debugger.out.log
wmpf-debugger.err.log
longmao-web.out.log
longmao-web.err.log
```

## Linux 微信 / WMPF 注意事项

Longmao 安装器不会替你安装微信，也不会修改微信文件。

WMPFDebugger 当前上游明确列出的 Linux x86_64 WMPF 版本包括 14978 与 14910。微信/WMPF 版本超出上游支持范围时，Longmao 其他服务仍可启动，但 WMPF 的 9421/62000 可能保持 DOWN，需要按 WMPFDebugger 上游适配说明处理。
