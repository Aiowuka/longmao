# Sidecar 安装与启动

## Totoro

```sh
git clone https://github.com/yuyuyudlc/Totoro.git
cd Totoro
git checkout c499040d52c6e1d45f06f7949419799ccc770db9
pnpm install
```

配置 Totoro 自己的环境变量，使其连接你的 Totoro-compatible 后台：

```dotenv
SUNRUN_MINIPROGRAM_BASE_URL=https://你的后台
REDIS_URL=redis://127.0.0.1:6379
```

启动 Web：

```sh
pnpm dev
```

需要延迟队列时启动 Worker：

```sh
pnpm worker:run
```

## WMPFDebugger

独立克隆 WMPFDebugger 并按其上游 README 安装。

启动：

```sh
npx ts-node src/index.ts
```

Longmao 只使用它暴露的 loopback CDP proxy，不复制 hook/Frida/protobuf 实现。

## Longmao

```sh
cp config/totoro.example.json config/totoro.json
npm run web
```

确认三层分别在线：

```text
WMPFDebugger 9421 / 62000
Totoro        127.0.0.1:3000
Longmao       127.0.0.1:3210
```
