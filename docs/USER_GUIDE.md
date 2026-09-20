# Longmao 用户使用手册（Windows）

## 你最终会得到什么

桌面上只有一个主要入口：

```text
Longmao
```

双击后会自动启动：

```text
Memurai / Redis     127.0.0.1:6379
Totoro Web          127.0.0.1:3000
Totoro Worker       local process
WMPFDebugger        127.0.0.1:9421 / 62000
Longmao Web         127.0.0.1:3210
```

浏览器会自动打开 Longmao 控制台。

## 第一次安装

运行：

```text
LongmaoSetup-0.5.0-win-x64.exe
```

安装器本身只包含 Longmao。

首次配置会自动检查：

- Windows x64；
- Node.js 22+；
- Git；
- Memurai Developer / 其他 Redis-compatible 服务；
- Totoro pinned snapshot；
- WMPFDebugger pinned snapshot。

缺少 Node、Git 或 Memurai 时，安装器会通过 Windows Package Manager 安装。系统可能弹出 UAC，这是正常的。

随后只需要填写一个东西：

```text
你的后台 HTTPS origin
```

例如：

```text
https://api.example.com
```

只填写 origin，不要填写：

```text
https://api.example.com/wxxcx/...
```

安装器会自动生成 Totoro 和 Longmao 的对应配置。

## 每次使用

### 1. 双击 Longmao

桌面：

```text
Longmao
```

等待浏览器自动打开：

```text
http://127.0.0.1:3210
```

### 2. 看首页状态

正常情况下：

```text
Redis/Memurai      UP
Totoro             UP
Longmao            UP
WMPF Debug         UP
WMPF CDP           UP
```

如果 WMPF CDP 还没就绪，先继续下一步。

### 3. 打开微信和目标小程序

登录微信，进入连接你自有后台的小程序。

WMPFDebugger 使用 `--auto-detect`，Longmao 页面应逐渐看到 WMPF/CDP 就绪。

### 4. 点“连接 CDP”

Longmao 开始观察你配置的 backend origin。

只匹配该 origin 的请求。

### 5. 正常登录/刷新小程序

当小程序向你的后台请求并携带登录态后，Longmao 显示类似：

```text
Token: abcd…1234
```

这里只是脱敏预览，原始 Token 不展示。

### 6. 点“用捕获 Token 同步 Totoro”

Longmao 会依次调用 Totoro：

```text
/api/login/token
/api/sunrun/tasks
```

成功后页面显示账号资料和跑步任务。

### 7. 选择任务和路线

选择 Totoro 返回的任务。

如果任务有路线，选择一条路线。

Longmao 不修改任务，也不自己生成业务路线。

### 8. 点“生成 Totoro Preview”

实际调用：

```text
POST /api/sunrun/preview
```

页面展示 Totoro 原生 Preview，例如：

- 里程；
- 用时；
- 配速；
- 步数；
- 设备信息；
- Preview 有效期。

### 9. 确认后点“交给 Totoro 开始”

实际调用：

```text
POST /api/sunrun/start
```

后面的业务数据生成、场次创建和延迟队列都由 Totoro 原实现负责。

### 10. 查看任务状态

Longmao 通过：

```text
POST /api/sunrun/run-job
```

显示 Totoro Queue/Worker 状态和最终结果。

## 用完以后

开始菜单里运行：

```text
Longmao Stop
```

会停止：

- Longmao Web；
- Totoro Web；
- Totoro Worker；
- WMPFDebugger。

Memurai 作为 Windows 本地服务可以保持运行；它只监听本机配置。

## 修改后台

运行：

```text
Longmao Configure
```

重新填写新的 HTTPS origin。

它会同时更新：

- Longmao capture origin；
- Totoro `SUNRUN_MINIPROGRAM_BASE_URL`；
- Totoro fallback origin。

然后重新启动 Longmao。

## 修复安装

如果上游目录损坏、依赖丢失或 Totoro build 被删掉，运行：

```text
Longmao Repair
```

它会重新：

- 检查环境；
- fetch 固定 upstream commit；
- checkout pinned snapshot；
- 安装依赖；
- build Totoro。

## 日志

所有运行日志统一在：

```text
%LOCALAPPDATA%\LongmaoRuntime\logs
```

主要文件：

```text
longmao-web.out.log
longmao-web.err.log
totoro-web.out.log
totoro-web.err.log
totoro-worker.out.log
totoro-worker.err.log
wmpf-debugger.out.log
wmpf-debugger.err.log
```

## 更新原则

Longmao 不自动追踪 Totoro/WMPF 的 main。

每个 Longmao 版本绑定一个经过核对的 upstream commit。升级前先跑 contract tests，再更新 pinned snapshot。

这样不会因为上游某次修改突然把你的本地环境弄坏。
