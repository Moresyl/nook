# 并排预览验证记录

本记录对应 `feat/docked-preview` 基于 `b67917e` 的实现；不是已发布版本或全量 UI 对齐声明。

## 当前通过证据

- `nook-docked-preview-compact-types.log`：类型检查通过。
- `nook-docked-preview-compact-tests.log`：3 个文件、29 项测试通过，覆盖资源限制、窗口与嵌入视图生命周期、过期请求、准备／加载取消、缩放裁剪及失败清理。
- `nook-docked-preview-compact-build.log`：构建通过。
- `nook-docked-preview-native-compact.log`：9 组真实 Electron 检查通过，无运行时错误，正常退出 3062ms。SHA-256：`976e55ca06053267282f55d83240baf2e9445486cb48130f166d21770ec5fbeb`。
- 日志位于外部 `D:/GR/pi-pc/.firecrawl/`；结构化运行结果见 `project-preview-result.json`。
- 已查看八张 `project-dock-*` 浅／暗截图。主窗口捕获不包含原生子视图，因此主窗口和预览内容分别保存；没有声称获得完整原生窗口合成截图。

## 保留的失败及修正

1. `nook-docked-preview-native.log`：独立窗口刷新检查可能拿到旧窗口的就绪状态；改为等待新窗口标识与就绪状态，正常退出 4079ms。
2. `nook-docked-preview-native-ready.log`：关闭设置后预览未恢复；所有工具提示都会隐藏预览的规则改为仅处理相交工具提示，正常退出 3833ms。
3. `nook-docked-preview-native-overlay.log`：枚举正在销毁的独立窗口时读取空 webContents；检查窗口和内容是否已销毁，正常退出 5141ms。
4. `nook-docked-preview-native-owned.log`：最小窗口放大到 150% 后预览仅约 10 CSS 像素高；空间不足时改为代码／预览切换。当前通过记录为约 124 CSS 像素高，原失败正常退出 7752ms。

上述修正没有增加产品或测试超时，没有减少原有五组独立窗口检查。

## 未完成边界

后续生命周期与项目树联合检查已完成：`nook-docked-lifecycle-types.log` 类型通过，`nook-docked-lifecycle-tests.log` 为 4 个文件、73 项测试通过。`nook-docked-lifecycle-integration.log` 共 16 组（项目树 7 组、预览 9 组）通过，最终正常退出 1711ms，SHA-256 为 `5b88d72983b7695c980fb0cc6b98b93a616b7c59d90ce3c668255411c96da42b`。并排转独立窗口后核对 HTML／脚本／JSON 草稿与新会话存储，工作台草稿记录完全相同；移除项目时验证两类原生预览均被释放。发布门禁要求 9 组预览、4 组并排及两个生命周期标记，拒绝旧五组记录和缺失／不完整证据。

已合入主线 `b19492a` 的测试断言与失败清理改动，产品构建内容未因该次合并改变。完整组件与桌面回归仍需完成。当前记录不证明安装版／便携版、物理键盘与辅助技术、全部浏览器行为或 `E:/txt` 全部设计已经验收。

## 全量回归失败

`nook-docked-full-coverage.log` 对应默认双工作进程的完整覆盖率运行，进程退出码 1，日志 SHA-256 为 `b0d66ba9951eaea2e6aea82f02a1d25e181f6c4bcc771eaae4a5b4b111b5a811`。日志仅输出 MCP OAuth SSE 动态注册／授权／刷新／重启复用用例失败（3174ms），没有完整汇总或错误栈；不能推断其他测试全部通过，也不能据此确定失败或日志缺失原因。

不修改源码、断言和超时的单用例诊断 `nook-docked-oauth-sse-diagnostic.log` 随后通过（1 项通过、9 项未选择，用例耗时 1542ms）。这没有复现前次失败，也不替代完整回归或证明产品故障已修复。下一轮采用详细报告保留逐用例输出，继续追查失败。

详细报告的完整重跑 `nook-docked-full-coverage-verbose.log` 正常退出 0：79 个文件、823 项测试全部通过，耗时 172.14s，先前 SSE 用例通过（1272ms）。SHA-256：`c39ac742fb3b1abf73709faa83b95e28e62043d09f37717e0f5a3d1ee88ebd23`。覆盖率为语句 97.10%、分支 94.65%、函数 97.31%、行 99.34%，范围仍是契约与桌面服务，不包含 React 界面或新增原生视图管理器。这次没有修改产品、断言、并发数或超时；未确定上次失败原因，不能宣称针对它完成了产品修复。

托管侧另行核对主线 `b19492a` 的运行 `37406674189`：验证任务 `112085668013` 没有执行步骤，发布跳过。平台注释仍为账户付款失败或支出额度限制，属于托管执行阻碍，不是源码测试结果。
