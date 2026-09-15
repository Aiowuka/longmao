# 方法参考、来源与许可状态

核对日期：2026-09-15。这里记录思想与架构背景，不表示上游参与、背书或授权本项目。
longmao 的桥接与防护代码为独立编写，没有复制或打包下列仓库源码。集成实验从相邻的、固定 commit
Git checkout 启动或 import 上游模块；上游依然是独立进程/模块树，不成为本仓库的 vendored 内容。

## Totoro Sunrun — yuyuyudlc 与其贡献者

- 原仓库：https://github.com/yuyuyudlc/Totoro
- 参考版本：`5b3199f864e114f4981403d05c94160ebdd730ab`
- 文档：https://github.com/yuyuyudlc/Totoro/blob/5b3199f864e114f4981403d05c94160ebdd730ab/README.md
- 参考内容：客户端与服务端分层，以及任务读取、场次与提交等分阶段流程的描述。
- 许可状态：**未确认**。已查看的 README 与 package.json 未给出明确项目许可；这不是对全仓每个文件的法律审查。
- 本次处理：从相邻 checkout 启动其原生 Next.js 后端并 import `lib/server` 模块；不复制、修改或重新分发其实现、图片或素材。根目录未找到 LICENSE，因此不把可读性解释为再分发授权。

## WMPFDebugger — evi0s 与其贡献者

- 原仓库：https://github.com/evi0s/WMPFDebugger
- 参考版本：`e65e3ec98ea38de8ea78fc0ad02d01d9b2fd0345`
- 文档：https://github.com/evi0s/WMPFDebugger/blob/e65e3ec98ea38de8ea78fc0ad02d01d9b2fd0345/README.md
- 许可证：https://github.com/evi0s/WMPFDebugger/blob/e65e3ec98ea38de8ea78fc0ad02d01d9b2fd0345/LICENSE
- 集成内容：从相邻 checkout 启动其真实进程，并按上游 `src/index.ts` 实现连接 `ws://127.0.0.1:62000` CDP proxy。
- 上游说明为 **GNU GPL v2.0**。复制、修改或分发其受许可代码时，需要按适用条款保留版权、许可与源码等信息；单独写“感谢”不能代替履行许可证义务。
- 上游另外说明 `src/third-party` 包含来自微信开发工具、版权属于腾讯的代码，不能假设所有第三方素材都只受同一许可覆盖。本项目不复制或重新分发该目录或任何上游二进制。

## 本仓库的许可与署名

本仓库暂不选择公开再分发许可证，`package.json` 标记为 `private: true` 与 `UNLICENSED`；这不是对任何上游重新授权。
维护者可在后续审查中决定独立代码的许可证。两个项目、作者和贡献者的原有权利不受本说明改变。
`upstreams.lock.json` 固定运行时相邻 checkout 的版本；它不把上游源码变为本仓库内容。

GitHub 的许可说明：https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
