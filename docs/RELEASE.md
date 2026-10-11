# Nook 发布状态

**尚未发布。** 目标版本为 Windows x64 `0.1.0-alpha.1`。本轮模型比较修复已通过类型及 6 项真实桌面专项：11 次本地 HTTP 请求、3 次正常退出、无运行时错误，17 张原图逐张核验。中文保存错误在明暗窄窗口的 100%／125%／150% 缩放下完整可读，忙碌关闭状态与行为一致；重试从第一条回复开始，同组更新保留手动滚动。完整新单元、源码回归与分发仍须验收。

此前恢复通知修复候选的完整源码、未安装版及实际安装版各通过 296 项、42 次正常退出，安装器、便携、实际安装与卸载及十一份同包运行记录通过，三轮 57 张原图逐张核验。它证明冻结的恢复候选，不能代替新增模型比较修复后的完整回归与分发。全部参考界面与托管发布仍未完成。

此前项目工作树候选的实际安装版在第 234 项之后的 MCP PDF 恢复后发送检查超时，随后一次退出超时；原始失败和八份数据哨兵继续保留，该候选仍计为未通过。

已复现并修复恢复通知尚未返回时设置弹窗可以关闭或切换页面的问题。独立源码专项 8 项、发布策略 65 项及单元全量 1,135 项通过；新的完整源码、未安装版和实际安装版均通过恢复等待与恢复后显式发送。旧安装版超时原因仍未完全查明，不因本轮通过而改写旧失败。

修复后的全量单元 112 个文件／1,135 项通过。首轮完整桌面在第 186 项后超时：预览夹具切换主题后立即按 Esc，没有等待设置保存，截图检查发现设置仍打开；21 次退出均正常。原始失败已归档，夹具改为等待关闭操作可用后按 Esc，仍保留 5 秒期限；预览专项 10 项通过，2 张编辑器原图逐张检查，后续第三轮完整回归通过。

第二轮完整桌面通过上述预览位置，在第 214 项后因新增关闭辅助函数同时匹配模型比较弹窗头部与底部的两个按钮而失败；31 次退出均正常。选择器已限定到共享弹窗的直属头部。模型比较专项 6 项、11 次本地 HTTP 请求、3 次正常退出通过，9 张原图逐张核验；第三轮完整源码回归已通过。原失败继续保留。

## 本轮更新

新增独立 Git 工作树创建、列表与项目登记：选择新分支及起始版本，或使用未占用的已有分支。拒绝已有目标文件夹及强制重置，保护原项目的分支、暂存区、文件改动、编辑草稿和预览。钩子报错后展示实际创建结果，保留部分文件；项目登记失败可重试而不重复执行 Git 创建。[使用说明](PROJECT-WORKTREES.md)

会话上下文摘要与工具记录继续沿用已实现能力。参考资料 `E:\txt` 的全部页面、状态和交互尚未完成逐项对照，不能宣称 100% 采用。[设计对照](DESIGN-ALIGNMENT.md)

## 验证结果与范围

| 范围 | 结果 |
| --- | --- |
| 工作树服务及已有 Git 回归 | 25 项通过；工作树模块覆盖率语句 98.38%、分支 97.91%、函数 97.61%、行 100% |
| 工作树单元基线 | 112 个文件／1,135 项通过；语句 97.31%、分支 95.07%、函数 97.43%、行 99.42% |
| 工作树专项及原图 | 7 组通过；12 张原图逐张检查 |
| 工作树完整源码 | 296 项、42 次正常退出，无运行时错误；12 张工作树原图逐张检查 |
| 工作树候选完整未安装版 | 296 项、42 次正常退出，匹配冻结 EXE／ASAR；12 张工作树原图逐张检查 |
| 工作树候选额外分发 | 共享控件 4 项、文字提示 7 项、崩溃退出 2 项、实际启动器组件、便携 7 项／两次启动通过 |
| 工作树候选实际安装版 | 安装登记及快捷方式通过；完整桌面仅 234 项通过后失败，33 次正常退出及 1 次强制退出；不能接受 |
| 失败后恢复清理 | 精确核对自有安装与无存活进程后卸载；8 份原始失败哨兵保留且内容与哈希一致，失败仍计为失败 |
| 恢复通知缺陷复现 | 旧应用体在延迟真实恢复通知时未禁用关闭按钮，断言失败；原日志、工作区和截图保留 |
| 恢复通知修复专项 | 真实桌面 8 项、2 次正常退出，发布策略 65 项通过；7 张原图逐张检查 |
| 恢复修复后的单元全量 | 112 个文件／1,135 项通过；语句 97.31%、分支 95.07%、函数 97.43%、行 99.42% |
| 恢复修复后的完整桌面首轮 | 186 项通过后预览截图前置检查超时，21 次正常退出；失败保留，不计入完整通过 |
| 设置保存完成后的预览专项 | 10 项通过，1 次正常退出；2 张编辑器原图逐张检查 |
| 完整桌面第二轮 | 214 项通过后关闭辅助选择器严格匹配失败，31 次正常退出；失败现场保留，不计入完整通过 |
| 关闭选择器修复后比较专项 | 6 项、11 次本地 HTTP 请求、3 次正常退出通过；9 张原图逐张检查 |
| 恢复修复后的完整桌面第三轮 | 296 项、42 次正常退出，无运行时错误，最长退出 2,765 毫秒；236 个编译文件与修复专项逐项一致，19 张原图逐张检查 |
| 恢复修复候选完整未安装版 | 296 项、42 次正常退出，无运行时错误，最长退出 1,676 毫秒；匹配冻结 EXE／ASAR，19 张原图逐张检查 |
| 恢复修复候选完整实际安装版 | 296 项、42 次正常退出，无运行时错误，最长退出 2,273 毫秒；匹配冻结 EXE／ASAR，19 张原图逐张检查 |
| 恢复修复候选额外分发 | 共享控件 4 项、文字提示 7 项、崩溃退出 2 项、实际启动器组件、便携 7 项／两次启动、安装登记／快捷方式／卸载及十一份同包记录通过 |
| 恢复修复候选数据保留 | 卸载后核对四份新哨兵与八份原始失败哨兵；只清理四份本轮新建文件，八份原始内容与哈希保留 |
| 法律与身份审计 | 恢复修复候选 239 个产品文件、401 份依赖法律文档、20 个分发法律／源码文件通过；无旧产品显示身份或已移除字体引用 |
| 可执行文件签名 | 恢复修复候选安装器、便携程序与应用 EXE 均为 `NotSigned` |

覆盖率对应表中的实际基线或模块，不能代表后续修订后的全量结果。原始截图已归档，逐张检查的范围仅限表中明确列出的原图。原生选择器与延迟通知使用隔离夹具；本地协议服务验证请求和生命周期，不证明真实云服务的模型质量或账户行为。

[工作树源码专项](../verification/project-worktrees-review-result.json) · [完整源码](../verification/project-worktrees-full-review-result.json) · [完整源码原图](../verification/project-worktrees-full-originals-review-result.json) · [冻结候选与哈希](../verification/project-worktrees-package-candidate-result.json) · [安装版失败](../verification/project-worktrees-installed-failure-result.json)

[恢复通知修复专项](../verification/restore-dismiss-review-result.json) · [修复后全量单元](../verification/restore-lifecycle-unit-review-result.json) · [修复后完整桌面首轮失败](../verification/restore-lifecycle-source-preview-failure-result.json) · [设置保存等待与预览专项](../verification/restore-lifecycle-preview-focused-review-result.json)

[第二轮选择器失败](../verification/restore-lifecycle-modal-selector-failure-result.json) · [比较专项与九张原图](../verification/restore-lifecycle-comparison-focused-review-result.json)

[恢复修复后完整源码](../verification/restore-lifecycle-full-review-result.json) · [完整源码十九张原图](../verification/restore-lifecycle-full-originals-review-result.json)

[恢复修复冻结候选](../verification/restore-lifecycle-package-candidate-result.json) · [匹配分发与三十八张原图](../verification/restore-lifecycle-distribution-result.json) · [实际签名状态](../verification/restore-lifecycle-signatures-result.json)

新分发归档为 `E:/NookVerification/RestoreLifecycleDistributionRetry-20261011`。首次冻结辅助脚本遗漏 ASAR 中的 `out/` 路径前缀，在原生测试开始前失败；脚本和日志保留于 `RestoreLifecycleDistribution-20261011`，修正后重新逐项核对全部 236 个编译文件，没有修改应用或原生夹具。

随后新增的模型比较错误视口检查，在同一冻结应用体上复现提示落在滚动区域下方：错误上沿 618.39px，可视底沿 582.89px；原数据与草稿保留，三项先行检查和两次正常退出通过。原始证据在 `E:/NookVerification/ComparisonFeedbackBaselineFailure-20261011`；它不在此前完整 296 项的视口断言范围内。

模型比较现采用共享中文错误转换与布局阶段的提示定位，忙碌时禁用共享弹窗的关闭入口。暂停实际文件替换后，头部／底部关闭、重复提交和连接选择禁用，Esc 保留弹窗；失败后错误上下沿 564.39／582.39px，均处于 230.89–582.89px 的可视区域，保留原数据、草稿与选择，重试成功。首次等待夹具因异步恢复后调用临时 `require` 失败，三项先行检查及两次正常退出；原场景保留，改用标准计时器后按原有 5 秒期限通过。这里的结果只证明源码专项。

[模型比较原缺陷](../verification/comparison-feedback-baseline-failure-result.json) · [等待夹具失败](../verification/comparison-feedback-main-poll-failure-result.json) · [模型比较修复专项](../verification/comparison-feedback-focused-review-result.json) · [十张原图](../verification/comparison-feedback-originals-review-result.json)

窄窗口扩展检查保留了两次失败：浅色 125% 的错误矩形超过可视边界约 0.1 个 CSS 像素；增加现有 4px 滚动留白后七个错误场景通过，但成功重试沿用表单滚动位置，将第一条回复标题放在可视区上方。原始工作区、应用体、日志及两张实际失败原图保留。结果滚动仅在切换比较组时复位，修复后七个错误场景、重试首条标题和同组更新保留手动滚动均通过，未修改原有期限或放宽矩形断言。

[错误边界失败](../verification/comparison-feedback-error-matrix-failure-result.json) · [重试滚动失败](../verification/comparison-feedback-retry-scroll-failure-result.json) · [两张失败原图](../verification/comparison-feedback-matrix-failure-originals-result.json) · [修复后的主题／缩放检查](../verification/comparison-feedback-error-matrix-review-result.json) · [十七张原图](../verification/comparison-feedback-error-matrix-originals-result.json)

恢复通知修复的完整源代码、实际编译体、消费的测试与发布策略、日志和 7 张原图归档于 `E:/NookVerification/RestoreDismissNativePass-20261011`；原失败分别保留于 `RestoreDismissBaselineFailure-20261011` 和 `ProjectWorktreesInstalledMcpPdfFailure-20261011`。失败清理只移除经过身份核对的自有安装，未移除任一失败哨兵。

## 流水线与剩余工作

最近已记录的 [38105071597](https://github.com/Moresyl/nook/actions/runs/38105071597) 对应实际源码回归提交 `23ed689`。GitHub 因账户付款／支出额度限制没有启动任何验证步骤，发布任务跳过。仓库没有已配置的自托管运行器；原始运行、任务、注释与运行器 API 结果保留在仓库外。未创建发布标签，本地通过不等同于托管通过。

1. 补齐模型比较错误的明暗／缩放检查，以及新增修复后的完整回归与分发；恢复通知修复候选的同包分发已通过，旧失败继续保留。
2. 完成最新参考页面、状态与交互对照，以及真实系统、辅助技术、云服务和目标平台的剩余验收。
3. 托管验证通过后直接走标签流水线发布，核对具体中英文说明、源码、下载文件与 SHA-256。

完整范围见[交付要求](DELIVERY.md)。以前 289 项候选与工作树初始状态保留于[上下文候选及工作树初始验收历史](RELEASE-HISTORY-2026-10-11-WORKTREES.md)，更早的记录继续由历史文档链接。旧候选只证明其各自源码和应用体。
