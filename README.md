# longmao — WMPF + Totoro 本地编排器

Longmao 不再自己实现跑步业务逻辑。

当前职责非常明确：

- **WMPFDebugger**：负责微信小程序运行时调试与 CDP proxy。
- **Totoro**：负责 Token 验证、任务获取、Preview、跑步计划/轨迹生成、开始流程、Redis 延迟队列与最终提交。
- **Longmao**：负责本地 Web UI、CDP 登录态捕获，以及对两个 sidecar 的编排。

```text
微信小程序
   ↓
WMPFDebugger
   ↓  ws://127.0.0.1:62000
Longmao CDP Observer
   ↓  捕获 Token（仅内存）
Totoro HTTP Sidecar
   ↓
你自己的 Totoro-compatible 后台
```

## 1. 启动 Totoro

建议使用 Longmao 当前核对过的 Totoro snapshot：

```text
yuyuyudlc/Totoro
c499040d52c6e1d45f06f7949419799ccc770db9
```

Totoro 单独克隆、安装和运行；Longmao 不复制它的源码。

在 Totoro 目录配置：

```dotenv
SUNRUN_MINIPROGRAM_BASE_URL=https://你的后台
REDIS_URL=redis://127.0.0.1:6379
```

然后：

```sh
pnpm install
pnpm dev
```

如果使用 Totoro 的延迟跑步队列，还需要另一个终端：

```sh
pnpm worker:run
```

默认 Longmao 预期 Totoro 在：

```text
http://127.0.0.1:3000
```

## 2. 启动 WMPFDebugger

WMPFDebugger 也保持独立安装：

```sh
npx ts-node src/index.ts
```

默认端口：

- remote debug bridge: `9421`
- CDP proxy: `62000`

## 3. 配置 Longmao

复制：

```sh
cp config/totoro.example.json config/totoro.json
```

Windows PowerShell：

```powershell
Copy-Item config/totoro.example.json config/totoro.json
```

修改：

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "capture": {
    "origin": "https://你的后台",
    "pathPrefixes": ["/wxxcx/"],
    "requestHeaderNames": ["authorization"],
    "responseJsonPaths": ["token", "data.token"]
  }
}
```

`capture.origin` 应与 Totoro 的 `SUNRUN_MINIPROGRAM_BASE_URL` 指向同一业务后台。

`config/totoro.json` 已加入 `.gitignore`。

## 4. 启动 Longmao

```sh
npm run web
```

浏览器打开：

```text
http://127.0.0.1:3210
```

Windows 可双击 `start-web.bat`。

## 5. 实际工作流

在页面中：

```text
WMPF 9421 / 62000 在线
        ↓
连接 CDP
        ↓
在微信小程序正常登录/访问你的后台
        ↓
Longmao 捕获 Token（只在进程内存）
        ↓
“用捕获 Token 同步 Totoro”
        ↓
Totoro /api/login/token
        ↓
Totoro /api/sunrun/tasks
        ↓
选择 Totoro 返回的任务和路线
        ↓
Totoro /api/sunrun/preview
        ↓
Totoro /api/sunrun/start
        ↓
Totoro /api/sunrun/run-job
```

Longmao 不生成路线、不生成跑步轨迹、不构造 Totoro 的业务提交包。

## 6. 当前复用的 Totoro API

Longmao 只调用以下固定接口：

- `POST /api/login/token`
- `POST /api/sunrun/tasks`
- `POST /api/sunrun/preview`
- `POST /api/sunrun/start`
- `POST /api/sunrun/run-job`

不存在任意 URL / Header / Body 的通用请求重放接口。

## 7. Token 边界

CDP 登录态捕获仍然做 allowlist：

- 只有 `capture.origin` 完全匹配时才记录 Network 摘要。
- 只有配置的 pathname prefix 才尝试提取 Token。
- 原始 Token 只在 Longmao Node 进程内存中。
- 前端只显示脱敏预览。
- 不写入 Git、配置文件或 artifacts。

## 8. Longmao 自身 Mock

原离线 Mock 继续保留，只作为 Longmao 自己的回归基线：

```sh
npm run doctor
npm test
npm run demo
npm run reproduce
npm run sources
```

Mock 通过不代表 Totoro、WMPF 或你的后台实机已验证。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/cdp-observer.mjs` | WMPF CDP 观察与 allowlisted Token 捕获 |
| `src/totoro-config.mjs` | Totoro sidecar / capture 配置 |
| `src/totoro-client.mjs` | Totoro 原生 HTTP API adapter |
| `src/web.mjs` | Longmao 本地编排 API |
| `web/` | 本地控制台 |
| `src/lab.mjs` | 独立离线 Mock 基线 |
| `upstreams.lock.json` | 当前核对的 Totoro / WMPF snapshots |

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
