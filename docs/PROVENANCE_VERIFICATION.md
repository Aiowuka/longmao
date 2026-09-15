# 来源声明补充与验证记录

日期：2026-09-15。基于已有分支 `feat/offline-reproduction-lab` 的提交 `2bb63a8c473387bdd1f932c09d1ab15e0e70d808` 增量修改，未替换原有模拟后端，未修改 main。

## 本次补充

- `npm run sources` 显示上游来源、作者/贡献者、完整 commit、许可核对状态与 `integrated: false`。
- `upstreams.lock.json` 增加明确署名字段和未集成状态；保留已有参考版本。
- `src/provenance.mjs` 校验两条不同的来源记录、commit 格式、URL 对应关系、核对日期及署名完整性。
- `doctor` 使用同一校验逻辑；新增 `tests/provenance.test.mjs` 的 7 项回归测试。

来源字段校验不是网络核验，也不能证明对某一文件已经取得了复制许可。WMPFDebugger 的 GPLv2 声明与第三方版权提示须分别看待；Totoro 根目录 LICENSE 未找到、package.json 未声明 license，本次仍将许可状态标注为未确认，不作全仓无许可证的断言。

## 实际执行结果

测试环境：Linux，Node.js `v22.16.0`，npm `10.9.2`。

- 原有 `src/lab.mjs` 的 Git blob hash：`f3fa555026318b694df098df877d4309899be15a`，与读取的分支文件一致。
- 原有 `tests/lab.test.mjs` 的 Git blob hash：`8617cb79c3b2e4b2e8d4343f4b6c50e82b10008c`，与读取的分支文件一致。
- `npm test`：38 项通过、0 失败，包括原有 31 项和新增 7 项。
- `npm run reproduce`：环境检查、38 项测试、成功模拟全部完成，退出码 0。
- `npm run sources` 的有效输出和错误参数处理由测试覆盖。

## 尚未验证及边界

没有在用户 Windows 电脑上运行，没有执行微信、WMPFDebugger 或 Totoro，没有读取真实 Token 或调用生产接口。本次本地验证不涵盖 Windows 启动脚本；远程 CI 结果应查看本次提交对应的 GitHub Actions。

当前依然是离线模拟实验，不是两个项目的实际连接，也不是自动代跑程序。既有 `VALIDATION.md` 记录的是此前 31 项测试的基线，本文件记录新增测试后的结果。
