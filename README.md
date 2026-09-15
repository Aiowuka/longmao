# longmao — 本地离线复现实验

> **交付范围：可运行的本地模拟流水线，不是自动代跑程序。**
> 未连接微信、WMPFDebugger、Totoro 或学校生产后端；不提取 Token，不提交真实成绩。
> 模拟测试通过不表示官方接口可用、上游集成成功或跑步记录有效。

## 一键运行

需要 Node.js 22 或更高版本。没有第三方运行依赖，**不需要 `npm install`、微信或服务器**。
在本分支的项目目录运行：

```sh
npm run reproduce
```

该命令依次检查本地环境、执行自动化测试、运行一次成功模拟，并保存 `artifacts/last-report.json`。
Windows 也可以双击根目录 `start.bat` 运行环境检查与模拟。
程序运行结束即退出，不会建立后台定时任务或监听公网端口。

```sh
npm run doctor
npm test
npm run demo
node src/cli.mjs demo --scenario expired-session
node src/cli.mjs demo --scenario rejected-submission
```

后两种场景用于验证异常处理，**预期退出码为 1**，不代表安装失败。成功场景返回 0。
每次模拟覆盖本地报告；报告目录默认不进入 Git。

## 实现内容

```text
模拟登录 → 读取固定测试任务 → 创建内存任务
       → 准备固定示例 → 内存提交 → 验证模拟回执
```

这是一个独立编写的离线状态机。示例只含 `demoOnly`、`fixtureId`、`sampleCount`，没有地理轨迹、真实用户或生产请求结构。
实现了会话检查、状态检查、幂等提交、失败停止、清理、固定错误码及 JSON 报告。
输入不支持外部 URL、Cookie、真实 Token 或动态执行插件；没有可切换到生产环境的适配器。

| 路径 | 作用 |
| --- | --- |
| `src/lab.mjs` | 固定模拟数据、内存后端与六阶段编排 |
| `src/cli.mjs` | 环境检查、命令行入口和原子报告写入 |
| `tests/lab.test.mjs` | 成功、失败、幂等、输入与命令行回归测试 |
| `start.bat` | Windows 本地启动入口 |
| `.github/workflows/ci.yml` | Ubuntu / Windows，Node.js 22 / 24 测试矩阵 |
| `THIRD_PARTY_NOTICES.md` | 方法来源、作者与许可状态 |
| `upstreams.lock.json` | 固定参考版本；不是可执行依赖 |

## 方法参考与致谢

感谢 [yuyuyudlc/Totoro](https://github.com/yuyuyudlc/Totoro) 和
[evi0s/WMPFDebugger](https://github.com/evi0s/WMPFDebugger) 的作者及贡献者公开项目资料。
本实验参考了“运行时观察与业务客户端分工”和“分阶段任务流水线”的架构背景。
**不把上游成果声称为本项目原创，也不声称这份模拟代码是两个仓库的接线实现。**

WMPFDebugger 上游声明 GPLv2；Totoro 在已核对材料中的许可证未确认。
本次未复制上游代码或二进制。详细参考版本、许可注意事项及第三方版权说明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 验证边界

当前交付在 Linux / Node.js 22.16.0 中执行了自动化测试和命令行模拟。
Windows 启动脚本及其他运行环境需以对应 CI 或实机执行结果为准，不能用 Linux 测试替代。
CI 配置的存在不等于 CI 已通过；请检查该提交对应的 Actions 结果。
没有对微信、任何真实账号、定位、人脸或学校服务器做验证。

本仓库保持私有；独立代码的公开许可证尚未由维护者选择，暂标记 `UNLICENSED`。

## 查看来源记录

```sh
npm run sources
```

该命令显示两个上游的作者/贡献者、完整参考 commit、许可核对状态，以及 `integrated: false`。
`doctor` 也会校验来源清单，防止漏署名、重复项目、无效版本号或将未集成误写为已集成。
来源验证只针对本地元数据，不会联网证明当前许可证状态或代码兼容性。
新增的 7 项来源测试与原有 31 项测试合计 38 项；本次验证详情见 [docs/PROVENANCE_VERIFICATION.md](docs/PROVENANCE_VERIFICATION.md)。
