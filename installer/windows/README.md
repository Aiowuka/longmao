# Windows 一键安装

## 给最终用户

优先使用 GitHub Actions / Release 生成的：

```text
LongmaoSetup-0.5.0-win-x64.exe
```

安装器只包含 Longmao 自己的代码。

首次安装向导会：

1. 检查 Node.js >= 22；
2. 检查 Git；
3. 检查本地 Redis-compatible 服务；
4. 如缺失，使用 Windows Package Manager 安装 Node/Git/Memurai Developer；
5. 从各自官方 GitHub 仓库拉取固定 commit 的 Totoro 和 WMPFDebugger；
6. 安装上游依赖；
7. 询问一次你的 Totoro-compatible 后台 HTTPS origin；
8. 构建 Totoro；
9. 创建桌面和开始菜单快捷方式；
10. 启动 Redis、Totoro、Totoro Worker、WMPFDebugger、Longmao。

Totoro 与 WMPFDebugger 不包含在 Longmao 安装包中。

## 无 EXE 时

仓库目录双击：

```text
Install Longmao.cmd
```

效果等价。

## Runtime 目录

```text
%LOCALAPPDATA%\LongmaoRuntime
├─ upstreams\
│  ├─ Totoro\
│  └─ WMPFDebugger\
├─ logs\
├─ totoro.json
├─ runtime.json
└─ processes.json
```

## 快捷方式

- Longmao：启动完整本地栈并打开浏览器
- Longmao Stop：关闭 Longmao/Totoro/WMPF 进程
- Longmao Status：查看五个本地端口
- Longmao Configure：修改自有后台 origin
- Longmao Repair：重新核对依赖、上游 pinned commits 并重建 Totoro

## Memurai

Longmao 的 Windows 本地开发/个人使用安装方案使用 Memurai Developer 作为 Redis-compatible 服务。

它由安装器通过 Windows Package Manager 从 Memurai 的发布渠道安装，不随 Longmao 重新分发。其授权由 Memurai 自己的许可条款约束。
