# longmao — 本地 Web 自动化实验台

> 当前交付是 **本地 Web 控制台 + 离线流程 Mock + WMPFDebugger 本机状态桥**。
> 不读取微信凭据，不抓取业务请求，不重放生产请求，不连接学校生产后端，不提交真实成绩。

## 直接启动网站

需要 Node.js 22 或更高版本。Longmao 本身没有第三方运行依赖。

```sh
npm run web
```

然后打开：

```text
http://127.0.0.1:3210
```

Windows 也可以双击 `start-web.bat`。Web 服务代码拒绝绑定 `0.0.0.0`，默认只监听 `127.0.0.1`。

页面目前提供：

- WMPFDebugger 默认端口状态：debug bridge `9421`、CDP proxy `62000`。
- 一键运行成功 Mock、会话过期 Mock、拒绝提交 Mock。
- 查看最近一次本地实验报告。
- 查看两个上游项目的来源与许可记录。
- 明确显示当前能力边界：无凭据捕获、无请求重放、无外部提交。

如果你已经单独克隆并安装 WMPFDebugger，可在它自己的目录按上游方式启动：

```sh
npx ts-node src/index.ts
```

Longmao 不启动或复制 WMPFDebugger，只通过 `127.0.0.1` 探测其两个默认 WebSocket 端口是否处于监听状态。端口可通过 `LONGMAO_WMPF_DEBUG_PORT` 与 `LONGMAO_WMPF_CDP_PORT` 修改，但主机固定为 loopback。

## 离线实验与测试

```sh
npm run doctor
npm test
npm run demo
npm run reproduce
npm run sources
```

离线流程保持原有六阶段状态机：

```text
模拟登录 → 读取固定测试任务 → 创建内存任务
       → 准备固定示例 → 内存提交 → 验证模拟回执
```

示例只含 `demoOnly`、`fixtureId`、`sampleCount`，没有地理轨迹、真实用户或生产请求结构。每次运行的报告保存在 `artifacts/last-report.json`。

## 架构

```text
Browser
  │  http://127.0.0.1:3210
  ▼
Longmao Local Web
  ├─ Mock runner ─────────► src/lab.mjs
  ├─ Report store ────────► artifacts/last-report.json
  ├─ Provenance ──────────► upstreams.lock.json
  └─ WMPF readiness ──────► 127.0.0.1:9421 / 62000
```

详细说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 主要路径

| 路径 | 作用 |
| --- | --- |
| `src/web.mjs` | loopback-only 本地 HTTP 服务与 API |
| `src/wmpf-bridge.mjs` | WMPF 两个本机端口的 TCP readiness probe |
| `web/` | 本地控制台前端 |
| `src/lab.mjs` | 固定模拟数据、内存后端与六阶段编排 |
| `src/cli.mjs` | 环境检查、来源显示和离线 CLI |
| `tests/web.test.mjs` | Web API、loopback 绑定和能力边界测试 |
| `THIRD_PARTY_NOTICES.md` | 方法来源、作者与许可状态 |
| `upstreams.lock.json` | 固定参考版本；不是可执行依赖 |

## 方法参考与致谢

感谢 [yuyuyudlc/Totoro](https://github.com/yuyuyudlc/Totoro) 和
[evi0s/WMPFDebugger](https://github.com/evi0s/WMPFDebugger) 的作者及贡献者公开项目资料。

- Totoro：参考客户端/服务端分层与分阶段流程的架构背景；本仓库没有复制其生产请求实现。
- WMPFDebugger：参考运行时调试层与业务层分离的思路；本仓库只做 loopback 端口 readiness probe，不复制或打包上游源码。

WMPFDebugger 上游声明 GPLv2；Totoro 在此前核对材料中的明确项目许可尚未确认。详细记录见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 边界

当前版本没有：

- Token / Cookie / Authorization 捕获；
- WMPF WebSocket 消息读取；
- 真实定位或轨迹生成；
- 生产请求重放；
- 学校后端地址输入；
- 真实成绩提交 API；
- 公网监听。

模拟测试通过只说明本仓库自己的本地控制流与防护边界通过测试，不表示任何真实业务接口可用。
