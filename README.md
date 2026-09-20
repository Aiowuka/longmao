# longmao — 本地 WMPF / CDP 自动化实验台

Longmao 现在包含三层：

1. **WMPFDebugger sidecar**：负责把微信小程序运行时暴露成 CDP。
2. **Longmao CDP Observer**：连接 `ws://127.0.0.1:62000`，观察自有后台请求并自动捕获登录态。
3. **Self-hosted Backend Flow**：对你自己的后台执行固定的 `profile → tasks → start → submit → receipt` 流程，并本地生成带明确 synthetic 标识的测试跑步数据。

同时保留原来的离线 Mock 流程作为回归基线。

## 启动

需要 Node.js 22+。

```sh
npm run web
```

打开：

```text
http://127.0.0.1:3210
```

Windows 可以双击 `start-web.bat`。

## 配置你自己的后台

```sh
cp config/backend.example.json config/backend.json
```

然后把 `origin` 和五个 endpoint 改成你的后台。详细 contract：

- [docs/SELF_HOSTED_BACKEND.md](docs/SELF_HOSTED_BACKEND.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

`config/backend.json` 已经加入 `.gitignore`。

远程后台必须 HTTPS；只有 localhost / 127.0.0.1 / ::1 可以使用 HTTP。

## 启动 WMPFDebugger

在 WMPFDebugger 自己的目录按上游方式运行：

```sh
npx ts-node src/index.ts
```

默认：

- remote-debug bridge: `9421`
- CDP proxy: `62000`

Longmao 页面先确认两个端口在线，然后点击 **连接 CDP**。

## 自动登录态链路

连接后，Longmao 会启用：

- `Network.enable`
- `Runtime.enable`
- `Page.enable`

当你在小程序里正常登录/访问自己的后台时，Longmao 只检查与 `backend.json.origin` 完全一致的请求。

Token 可以按配置从：

- 请求 Header；
- JSON 响应字段；

中捕获。

原始 Token：

- 只在 Node 进程内存中存在；
- 不写入 artifacts；
- 不写入 config；
- Web 页面只显示脱敏预览；
- 没有返回明文 Token 的 API。

## 自有后台完整流程

捕获 Token 后，可在页面执行：

```text
profile（可选）
  ↓
tasks（可选）
  ↓
生成 synthetic run
  ↓
start
  ↓
submit
  ↓
receipt（可选）
```

运行表单填写：

- taskId
- 距离
- 时长
- 中心经纬度

Longmao 独立生成圆形多圈测试轨迹。提交对象明确包含：

```json
{
  "synthetic": true,
  "generatedBy": "longmao-test-generator"
}
```

因此你的后台可以明确区分 Longmao 生成的数据。

## CDP 时间线

页面可以查看：

- 自有后台 request path / method
- response status / mimeType
- 页面导航
- console 事件级别和参数数量
- 登录态捕获事件

不会展示：

- 其他 origin 的 Network 请求
- Console 参数值
- 明文 Token

## 离线基线

```sh
npm run doctor
npm test
npm run demo
npm run reproduce
npm run sources
```

原有六阶段 Mock 仍然存在：

```text
模拟登录 → 固定任务 → 内存场次 → 固定样本 → Mock 提交 → 回执验证
```

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/cdp-observer.mjs` | CDP 连接、事件摘要、allowlisted auth capture |
| `src/backend-config.mjs` | 自有后台配置校验 |
| `src/owned-backend.mjs` | 固定的自有后台状态机 |
| `src/run-generator.mjs` | synthetic test run 生成器 |
| `src/web.mjs` | loopback-only 本地 Web/API |
| `config/backend.example.json` | 后台配置模板 |
| `docs/SELF_HOSTED_BACKEND.md` | 后台 contract |
| `src/lab.mjs` | 原离线 Mock |
| `upstreams.lock.json` | 上游参考版本与署名 |

## 上游

- [yuyuyudlc/Totoro](https://github.com/yuyuyudlc/Totoro)：参考分阶段业务流程思想；Longmao 的自有后台 contract 与生成器为独立实现。
- [evi0s/WMPFDebugger](https://github.com/evi0s/WMPFDebugger)：作为独立 sidecar 提供 WMPF remote-debug / CDP proxy。

WMPFDebugger 上游声明 GPLv2；Longmao 不复制或打包其源码。详细来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
